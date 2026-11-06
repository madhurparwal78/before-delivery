// Car page (brief: Screens and layout › Car page): bay and bay billing, belongings, the signed
// condition report, photos, care history and releases.
import { useEffect, useRef, useState } from "react";
import type { Bay, Car, CarDetail, Item, Movement, Photo, Report } from "../../shared/api.js";
import { BAY_CLASS_LABEL, FLAG_LABEL, ITEM_KINDS, ITEM_KIND_LABEL, type ItemKind } from "../../shared/domain.js";
import { formatDistance, formatPressure, pressureToCentibar } from "../../shared/units.js";
import { formatMoment, formatSlot } from "../../shared/zurich.js";
import { HttpError, Interrupted, NoAnswer, errorCode, get, request } from "../api.js";
import { FloorPlan } from "../FloorPlan.js";
import { applyInPlace, useLoad, usePoll } from "../hooks.js";
import { RELEASE_STATUS_LABEL, SIGNED_IN_AGAIN, bayBillingLabel, chf } from "../labels.js";
import { NotFound } from "../ui/NotFound.js";
import { useSession } from "../session.js";
import { Dialog } from "../ui/Dialog.js";
import { ErrorSummary, FieldError, StartupBadge, StatusRegion, summaryOf, useNote } from "../ui/Feedback.js";
import { Icon } from "../ui/Icon.js";
import { ProgressBar, UploadField } from "../ui/Upload.js";

/** Whether a car's bay billing may still change without anyone on this screen acting. */
export function billingUnsettled(car: Car): boolean {
  const billing = car.bay_billing;
  return car.open_release || billing.status === "pending" || (billing.cancel_requested && billing.status !== "ending");
}

export function CarPage({ carId }: { carId: string }): JSX.Element {
  const { user } = useSession();
  const { data: car, setData: setCar, missing } = useLoad(() => get<{ car: CarDetail }>(`/api/cars/${carId}`, true).then((a) => a.car), [carId]);
  const [bayNote, sayBay] = useNote();
  const [itemNote, sayItem] = useNote();
  const [uploadNote, sayUpload] = useNote();
  const [progress, setProgress] = useState<number | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState(false);

  const reload = async (): Promise<void> => {
    const fresh = (await get<{ car: CarDetail }>(`/api/cars/${carId}`)).car;
    setCar(fresh);
  };

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

  const desk = user.role === "concierge" || user.role === "house_manager";
  const released = car.status === "released";

  const move = async (item: Item, direction: "in" | "out"): Promise<void> => {
    sayItem("Saving...");
    try {
      const answer = await request<{ item: Item; movement: Movement }>(`/api/belongings/${item.id}/movements`, {
        method: "POST",
        body: { direction, count: 1 },
      });
      setCar({ ...car, belongings: car.belongings.map((entry) => (entry.id === item.id ? answer.data.item : entry)) });
      sayItem(`${answer.data.item.label}: ${answer.data.item.count_in} checked in.`);
    } catch (error) {
      sayItem(belongingsError(error, item.label), "error");
    }
  };

  return (
    <div className="screen">
      <header className="car-identity">
        <h1 className="identity">{car.name}</h1>
        <p className="identity-sub">
          <span className="mono-text">{car.registration}</span> · {car.colour} · {car.owner.name}
        </p>
      </header>
      <div className="car-columns">
        <div className="car-column">
          <section className="panel-section" aria-labelledby="bay-heading">
            <h2 id="bay-heading" className="section-heading">
              Bay and bay billing
            </h2>
            <StatusRegion name="Bay updates" note={bayNote} />
            <dl className="facts">
              <div>
                <dt>Bay</dt>
                <dd>
                  {car.bay ? (
                    <>
                      <span className="mono-text">{car.bay.code}</span>
                      {` · ${BAY_CLASS_LABEL[car.bay.class]}`}
                    </>
                  ) : (
                    "No bay"
                  )}
                </dd>
              </div>
              <div>
                <dt>Start-up</dt>
                <dd>
                  <StartupBadge startup={car.startup} />
                </dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd className="mono-text">{`${car.length_mm} × ${car.width_mm} mm`}</dd>
              </div>
              <OdometerFacts car={car} />
            </dl>
            <p className="billing-line" role="group" aria-label="Bay billing">
              {bayBillingLabel(car.bay_billing)}
            </p>
            {car.bay_billing.plan && car.bay_billing.monthly_price ? (
              <p className="sub mono-text">{`${car.bay_billing.plan} · ${chf(car.bay_billing.monthly_price)} / month`}</p>
            ) : null}
            {desk && !released ? (
              <button type="button" className="button" onClick={() => setChoosing(true)}>
                Choose bay
              </button>
            ) : null}
          </section>

          <section className="panel-section" aria-labelledby="belongings-heading">
            <div className="section-head-row">
              <h2 id="belongings-heading" className="section-heading">
                Belongings
              </h2>
              {desk && !released ? (
                <button type="button" className="button" onClick={() => setAdding(true)}>
                  Add item
                </button>
              ) : null}
            </div>
            <StatusRegion name="Belongings updates" note={itemNote} />
            <table aria-label="Belongings" className="table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Checked in</th>
                  {desk && !released ? <th scope="col">Movements</th> : null}
                </tr>
              </thead>
              <tbody>
                {car.belongings.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.label}
                      <span className="sub">{ITEM_KIND_LABEL[item.kind]}</span>
                    </td>
                    <td className="mono-text">{item.count_in}</td>
                    {desk && !released ? (
                      <td>
                        <div className="row-actions">
                          <button type="button" className="button small" aria-label={`Check in ${item.label}`} onClick={() => void move(item, "in")}>
                            Check in
                          </button>
                          <button type="button" className="button small" aria-label={`Check out ${item.label}`} onClick={() => void move(item, "out")}>
                            Check out
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {car.belongings.length === 0 ? <p className="empty">No belongings logged.</p> : null}
          </section>

          <section className="panel-section" aria-labelledby="report-heading">
            <h2 id="report-heading" className="section-heading">
              Condition report
            </h2>
            <ReportView report={car.condition_report} />
            {desk && !released && !car.condition_report ? (
              <UploadField<{ report: Report }>
                label="Signed condition report (PDF)"
                button="Upload report"
                accept="application/pdf"
                path={`/api/cars/${car.id}/condition-report`}
                fields={[]}
                pending={() => "Uploading signed condition report..."}
                success={`Signed condition report stored for ${car.name}.`}
                say={sayUpload}
                progress={{ value: progress, set: setProgress }}
                onStored={(answer) => setCar({ ...car, condition_report: answer.report })}
              />
            ) : null}
          </section>
        </div>

        <div className="car-column">
          <section className="panel-section" aria-labelledby="photos-heading">
            <h2 id="photos-heading" className="section-heading">
              Photos
            </h2>
            <StatusRegion name="Upload updates" note={uploadNote} />
            <ProgressBar value={progress} />
            <PhotoList photos={car.photos} />
            {desk && !released ? (
              <UploadField<{ photo: Photo }>
                label="Intake photo"
                button="Upload photo"
                accept="image/jpeg,image/png"
                path={`/api/cars/${car.id}/photos`}
                fields={[["kind", "intake"]]}
                pending={(name) => `Uploading ${name}...`}
                success={`Photo attached to ${car.name}.`}
                say={sayUpload}
                progress={{ value: progress, set: setProgress }}
                onStored={() => void reload().catch(() => undefined)}
              />
            ) : null}
          </section>
          <section className="panel-section" aria-labelledby="care-heading">
            <h2 id="care-heading" className="section-heading">
              Care history
            </h2>
            <CareHistory car={car} />
          </section>
          <section className="panel-section" aria-labelledby="releases-heading">
            <h2 id="releases-heading" className="section-heading">
              Releases
            </h2>
            {car.releases.length === 0 ? (
              <p className="empty">No releases requested.</p>
            ) : (
              <ul className="plain-list">
                {car.releases.map((release) => (
                  <li key={release.id}>
                    <span className="mono-text">{formatSlot(release.slot)}</span> · {RELEASE_STATUS_LABEL[release.status]}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      {choosing ? (
        <ChooseBay
          car={car}
          onClose={() => setChoosing(false)}
          say={sayBay}
          onAssigned={(next) => {
            setChoosing(false);
            setCar({ ...car, ...next });
          }}
        />
      ) : null}
      {adding ? (
        <AddItem
          carId={car.id}
          say={sayItem}
          onClose={() => setAdding(false)}
          onAdded={(item) => {
            setAdding(false);
            setCar({ ...car, belongings: [...car.belongings, item] });
          }}
        />
      ) : null}
    </div>
  );
}

function OdometerFacts({ car }: { car: Car }): JSX.Element {
  const { units } = useSession();
  return (
    <>
      <div>
        <dt>Odometer</dt>
        <dd className="mono-text">{formatDistance(car.odometer_km, units.distance)}</dd>
      </div>
      <div>
        <dt>Tyre spec</dt>
        <dd className="mono-text">{formatPressure(pressureToCentibar(car.tyre_spec_bar, "bar") ?? 0, units.pressure)}</dd>
      </div>
    </>
  );
}

function belongingsError(error: unknown, label: string): string {
  const code = errorCode(error);
  if (code === "insufficient_items") return `Nothing left to check out for ${label}.`;
  if (code === "car_released") return "This car has been released.";
  if (error instanceof Interrupted) return SIGNED_IN_AGAIN;
  if (error instanceof NoAnswer) return "No answer from the server. Nothing was saved; press again.";
  if (error instanceof HttpError) return Object.values(error.fields)[0] ?? "Nothing was saved.";
  return "Nothing was saved.";
}

export function ReportView({ report }: { report: Report | null }): JSX.Element {
  if (!report) return <p className="empty">No signed condition report stored for this stay.</p>;
  return (
    <div className="report">
      <a className="report-link" href={`/api/condition-reports/${report.id}/file`}>
        <Icon name="fileCheck" />
        Download signed report
      </a>
      <p className="fingerprint mono-text">{report.sha256}</p>
      <p className="sub">{`${formatMoment(report.uploaded_at)} · ${report.uploaded_by.name} · ${report.size_bytes} bytes`}</p>
    </div>
  );
}

export function PhotoList({ photos }: { photos: Photo[] }): JSX.Element {
  return (
    <>
      <ul aria-label="Photos" className="photo-list">
        {photos.map((photo) => (
          <li key={photo.id}>
            <img src={`/api/photos/${photo.id}/content`} alt={`${photo.kind === "stage" ? "Stage" : "Intake"} photo, ${formatMoment(photo.created_at)}`} loading="lazy" />
          </li>
        ))}
      </ul>
      {photos.length === 0 ? (
        <p className="empty empty-drawn">
          <Icon name="image" size={32} />
          No photos attached yet.
        </p>
      ) : null}
    </>
  );
}

export function CareHistory({ car }: { car: CarDetail }): JSX.Element {
  const { units } = useSession();
  if (car.care_entries.length === 0) return <p className="empty">No care entries logged.</p>;
  return (
    <table aria-label="Care history" className="table">
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Entry</th>
        </tr>
      </thead>
      <tbody>
        {car.care_entries.map((entry) => (
          <tr key={entry.id}>
            <td>
              <span className="mono-text">{formatMoment(entry.at)}</span>
              <span className="sub">{entry.by.name}</span>
            </td>
            <td>
              {[
                entry.started ? "Start-up" : null,
                entry.battery_v ? `${entry.battery_v} V` : null,
                entry.tyres_bar
                  ? [entry.tyres_bar.fl, entry.tyres_bar.fr, entry.tyres_bar.rl, entry.tyres_bar.rr]
                      .map((bar) => formatPressure(pressureToCentibar(bar, "bar") ?? 0, units.pressure))
                      .join(" / ")
                  : null,
                entry.note || null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {entry.flags.length ? <span className="badge badge-alert">{`Flagged: ${entry.flags.map((flag) => FLAG_LABEL[flag]).join(", ")}`}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const BAY_ERRORS: Record<string, (code: string) => string> = {
  bay_occupied: (code) => `Bay ${code} was just taken. Choose another bay.`,
  bay_too_small: (code) => `Bay ${code} is too small for this car.`,
  bay_class_change: (code) => `Bay ${code} is a different bay class. Moves stay within the same class.`,
  car_released: () => "This car has been released.",
};

function ChooseBay({
  car,
  onClose,
  onAssigned,
  say,
}: {
  car: CarDetail;
  onClose: () => void;
  onAssigned: (car: Car) => void;
  say: (text: string, tone?: "info" | "error") => void;
}): JSX.Element {
  const [bays, setBays] = useState<Bay[] | null>(null);
  const [selected, setSelected] = useState<Bay | null>(null);
  const assignRef = useRef<HTMLButtonElement>(null);
  const planRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    get<{ bays: Bay[] }>(`/api/bays?fits=${encodeURIComponent(car.id)}`).then((answer) => setBays(answer.bays), () => setBays([]));
  }, [car.id]);

  useEffect(() => {
    if (selected) assignRef.current?.focus();
  }, [selected]);

  useEffect(() => {
    if (bays?.length) planRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [bays]);

  const assign = async (bay: Bay): Promise<void> => {
    say(`Assigning bay ${bay.code}...`);
    try {
      const answer = await request<{ car: Car }>(`/api/cars/${car.id}/bay`, { method: "POST", body: { bay_id: bay.id } });
      onAssigned(answer.data.car);
      say(`${answer.data.car.name} assigned to bay ${bay.code}.`);
    } catch (error) {
      const code = errorCode(error);
      const copy = code ? BAY_ERRORS[code] : undefined;
      if (copy) say(copy(bay.code), "error");
      else if (error instanceof Interrupted) say(SIGNED_IN_AGAIN);
      else say("No answer from the server. Nothing was assigned; press again.", "error");
    }
  };

  return (
    <Dialog title="Choose bay" onClose={onClose} wide>
      <div ref={planRef}>
      {bays === null ? (
        <p className="placeholder" aria-hidden="true" />
      ) : (
        <FloorPlan
          bays={bays}
          selected={selected?.id ?? null}
          onActivate={(bay) => {
            if (!bay.eligible) return;
            if (selected?.id === bay.id) assignRef.current?.focus();
            setSelected(bay);
          }}
        />
      )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        {selected ? (
          <button ref={assignRef} type="button" className="button primary" onClick={() => void assign(selected)}>
            {`Assign bay ${selected.code}`}
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}

function AddItem({
  carId,
  onClose,
  onAdded,
  say,
}: {
  carId: string;
  onClose: () => void;
  onAdded: (item: Item) => void;
  say: (text: string, tone?: "info" | "error") => void;
}): JSX.Element {
  const [kind, setKind] = useState<ItemKind>("key_set");
  const [label, setLabel] = useState("");
  const [count, setCount] = useState("1");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (): Promise<void> => {
    say("Saving...");
    try {
      const body = { kind, label, count: /^\d+$/.test(count) ? Number(count) : count };
      const answer = await request<{ item: Item }>(`/api/cars/${carId}/belongings`, { method: "POST", body });
      onAdded(answer.data.item);
      say(`${answer.data.item.label}: ${answer.data.item.count_in} checked in.`);
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) setErrors(error.fields);
      say(belongingsError(error, label), "error");
    }
  };

  return (
    <Dialog title="Add item" onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorSummary items={summaryOf(errors, ["kind", "label", "count"])} idFor={(field) => `item-${field}`} />
        <div className="field">
          <label htmlFor="item-kind">Item kind</label>
          <select id="item-kind" value={kind} onChange={(event) => setKind(event.target.value as ItemKind)}>
            {ITEM_KINDS.map((option) => (
              <option key={option} value={option}>
                {ITEM_KIND_LABEL[option]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="item-label">Item label</label>
          <input id="item-label" type="text" value={label} onChange={(event) => setLabel(event.target.value)} />
          <FieldError id="item-label-error" message={errors.label} />
        </div>
        <div className="field">
          <label htmlFor="item-count">Count</label>
          <input id="item-count" type="number" inputMode="numeric" min={0} max={20} value={count} onChange={(event) => setCount(event.target.value)} />
          <FieldError id="item-count-error" message={errors.count} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Add
          </button>
        </div>
      </form>
    </Dialog>
  );
}
