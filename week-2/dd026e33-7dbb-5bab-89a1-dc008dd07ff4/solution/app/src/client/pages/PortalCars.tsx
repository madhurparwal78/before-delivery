// Owner portal: My cars and the owner's car page (brief: Screens and layout › Owner portal;
// Interactions › My cars and the car page).
import { useEffect, useRef, useState } from "react";
import type { Car, CarDetail, Invoice, Photo } from "../../shared/api.js";
import { formatDay, formatSlot } from "../../shared/zurich.js";
import { get } from "../api.js";
import { applyInPlace, useLoad, usePoll } from "../hooks.js";
import { JOB_STATUS_LABEL, RELEASE_STATUS_LABEL, bayBillingLabel, bayLine, invoiceStatusLabel } from "../labels.js";
import { NotFound } from "../ui/NotFound.js";
import { navigate } from "../router.js";
import { Link } from "../Shell.js";
import { StartupBadge, StatusRegion, useNote } from "../ui/Feedback.js";
import { CareHistory, PhotoList, ReportView, billingUnsettled } from "./CarPage.js";

export function MyCars(): JSX.Element {
  const [cars, setCars] = useState<Car[] | null>(null);
  const [latestPhoto, setLatestPhoto] = useState<Record<string, Photo | undefined>>({});
  const [note, say] = useNote();
  const announced = useRef(new Set<string>());

  useEffect(() => {
    get<{ cars: Car[] }>("/api/cars", true).then(
      (answer) => {
        setCars(answer.cars);
        for (const car of answer.cars) if (car.bay_billing.billing_end_date) announced.current.add(car.id);
        for (const car of answer.cars) {
          get<{ car: CarDetail }>(`/api/cars/${car.id}`).then(
            (detail) => setLatestPhoto((current) => ({ ...current, [car.id]: detail.car.photos[detail.car.photos.length - 1] })),
            () => undefined,
          );
        }
      },
      () => undefined,
    );
  }, []);

  usePoll(
    async () => {
      const fresh = (await get<{ cars: Car[] }>("/api/cars")).cars;
      if (JSON.stringify(fresh) === JSON.stringify(cars)) return;
      applyInPlace(() => setCars(fresh));
      for (const car of fresh) {
        const end = car.bay_billing.billing_end_date;
        if (end && !announced.current.has(car.id)) {
          announced.current.add(car.id);
          say(`Bay billing for ${car.name} ends ${formatDay(end)}.`);
        }
      }
    },
    10_000,
    cars?.some(billingUnsettled) ?? false,
  );

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>My cars</h1>
        <StatusRegion name="Car updates" note={note} />
      </header>
      <ul aria-label="My cars" className="car-cards">
        {(cars ?? []).map((car) => {
          const photo = latestPhoto[car.id];
          return (
            <li key={car.id} className="car-card">
              <Link to={`/portal/cars/${car.id}`} className="car-card-name">
                {car.name}
              </Link>
              <p className="mono-text">{bayLine(car)}</p>
              <p>
              <StartupBadge startup={car.startup} />
            </p>
              <div className={photo ? "car-card-photo" : "car-card-photo car-card-photo-empty"}>
                {photo ? (
                  <img src={`/api/photos/${photo.id}/content`} alt={`Latest photo of ${car.name}`} loading="lazy" />
                ) : (
                  <span className="sub">No photo yet</span>
                )}
              </div>
              <p className="billing-line">{bayBillingLabel(car.bay_billing)}</p>
            </li>
          );
        })}
      </ul>
      {cars && cars.length === 0 ? <p className="empty">No cars are in the house's care.</p> : null}
    </div>
  );
}

export function PortalCar({ carId }: { carId: string }): JSX.Element {
  const { data: car, setData: setCar, missing } = useLoad(() => get<{ car: CarDetail }>(`/api/cars/${carId}`, true).then((answer) => answer.car), [carId]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    get<{ invoices: Invoice[] }>("/api/invoices").then(
      (answer) => setInvoices(answer.invoices.filter((invoice) => invoice.car.id === carId)),
      () => undefined,
    );
  }, [carId]);

  usePoll(
    async () => {
      const fresh = (await get<{ car: CarDetail }>(`/api/cars/${carId}`)).car;
      if (JSON.stringify(fresh) !== JSON.stringify(car)) applyInPlace(() => setCar(fresh));
    },
    10_000,
    car !== null && billingUnsettled(car),
  );

  if (missing) return <NotFound />;
  if (!car) return <div className="screen placeholder" aria-hidden="true" />;
  const canRequest = car.status === "stored" && !car.open_release;

  return (
    <div className="screen">
      <header className="car-identity">
        <h1 className="identity">{car.name}</h1>
        <p className="identity-sub">
          <span className="mono-text">{car.registration}</span> · {car.colour} · <span className="mono-text">{bayLine(car)}</span>
        </p>
        <p className="billing-line">{bayBillingLabel(car.bay_billing)}</p>
        {canRequest ? (
          <button type="button" className="button primary" onClick={() => navigate(`/portal/cars/${car.id}/release`)}>
            Request release
          </button>
        ) : null}
      </header>
      <div className="car-columns">
        <div className="car-column">
          <section className="panel-section" aria-labelledby="portal-photos-heading">
            <h2 id="portal-photos-heading" className="section-heading">
              Photos
            </h2>
            <PhotoList photos={car.photos} />
          </section>
          <section className="panel-section" aria-labelledby="portal-report-heading">
            <h2 id="portal-report-heading" className="section-heading">
              Condition report
            </h2>
            <ReportView report={car.condition_report} />
          </section>
          <section className="panel-section" aria-labelledby="portal-care-heading">
            <h2 id="portal-care-heading" className="section-heading">
              Care history
            </h2>
            <p>
              <StartupBadge startup={car.startup} />
            </p>
            <CareHistory car={car} />
          </section>
        </div>
        <div className="car-column">
          <section className="panel-section" aria-labelledby="portal-jobs-heading">
            <h2 id="portal-jobs-heading" className="section-heading">
              Jobs
            </h2>
            {car.jobs.length === 0 ? <p className="empty">No workshop jobs.</p> : null}
            <ul className="plain-list ruled-list">
              {car.jobs.map((job) => (
                <li key={job.id}>
                  <Link to={`/portal/jobs/${job.id}`}>{`${job.number} · ${job.title}`}</Link>
                  <span className="sub">{JOB_STATUS_LABEL[job.status]}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel-section" aria-labelledby="portal-invoices-heading">
            <h2 id="portal-invoices-heading" className="section-heading">
              Invoices
            </h2>
            {invoices.length === 0 ? <p className="empty">No invoices.</p> : null}
            <ul className="plain-list ruled-list">
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Link to={`/portal/invoices/${invoice.id}`}>{invoice.number}</Link>
                  <span className="sub">{invoiceStatusLabel(invoice)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel-section" aria-labelledby="portal-releases-heading">
            <h2 id="portal-releases-heading" className="section-heading">
              Releases
            </h2>
            {car.releases.length === 0 ? <p className="empty">No releases requested.</p> : null}
            <ul className="plain-list ruled-list">
              {car.releases.map((release) => (
                <li key={release.id}>
                  <Link to={`/portal/releases/${release.id}`}>{formatSlot(release.slot)}</Link>
                  <span className="sub">{RELEASE_STATUS_LABEL[release.status]}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
