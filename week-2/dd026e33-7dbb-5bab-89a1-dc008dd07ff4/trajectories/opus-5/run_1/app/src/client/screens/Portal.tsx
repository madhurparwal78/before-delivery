import { useRef, useState, type ReactNode } from 'react';
import type { CoatStack as CoatStackData } from '../../shared/coatstack';
import { slotTimeOptions, releaseActionAllowed } from '../../shared/releasestates';
import type { Car, CarDetail, Invoice, Job, Release } from '../../shared/types';
import { pressureReading, voltageReading } from '../../shared/units';
import { dateLabel, momentLabel } from '../../shared/zurich';
import {
  NOT_FOUND_HEADING,
  NO_ANSWER,
  IDEMPOTENCY_CONFLICT,
  RELEASE_HEADING,
  bayBillingLabel,
  cardBayLine,
  estimateLabel,
  holdLine,
  invoiceStatusLabel,
  outstandingLine,
  releaseAnnouncement,
  startupLabel,
  timestampDateLabel,
} from '../copy';
import { api, errorCode, fieldErrors } from '../lib/api';
import { useFirstLoad, useReread, useStatus, useSubmit, type StatusHandle } from '../lib/hooks';
import { Link, navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { Dialog } from '../components/Dialog';
import {
  AlertMark,
  ErrorSummary,
  FieldMessage,
  StatusRegion,
  type FieldError,
} from '../components/Status';
import { CoatStackPanes, useCoatStackAddress } from './JobPanes';

export function MyCarsScreen(): ReactNode {
  const status = useStatus();
  const [cars, setCars] = useState<Car[]>([]);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  /** End dates already on screen when the page opened are not announced. */
  const knownEndDates = useRef(new Set<string>());

  const load = async (): Promise<void> => {
    const outcome = await api<{ cars: Car[] }>('/api/cars');
    if (outcome.kind !== 'ok') return;
    for (const car of outcome.body.cars) {
      if (car.bay_billing.billing_end_date !== null && !knownEndDates.current.has(car.id)) {
        knownEndDates.current.add(car.id);
        status.announceOnce(
          `billing-end:${car.id}:${car.bay_billing.billing_end_date}`,
          `Bay billing for ${car.name} ends ${dateLabel(car.bay_billing.billing_end_date)}.`,
        );
      }
    }
    setCars(outcome.body.cars);
  };

  useFirstLoad(async () => {
    const outcome = await api<{ cars: Car[] }>('/api/cars');
    if (outcome.kind !== 'ok') return;
    for (const car of outcome.body.cars) {
      if (car.bay_billing.billing_end_date !== null) knownEndDates.current.add(car.id);
    }
    setCars(outcome.body.cars);
    const entries = await Promise.all(
      outcome.body.cars.map(async (car) => {
        const detail = await api<{ car: CarDetail }>(`/api/cars/${car.id}`);
        const photo = detail.kind === 'ok' ? (detail.body.car.photos[0] ?? null) : null;
        return [car.id, photo === null ? null : photo.id] as const;
      }),
    );
    setPhotos(Object.fromEntries(entries));
  });

  const watching = cars.some(
    (car) =>
      car.open_release ||
      car.bay_billing.status === 'pending' ||
      (car.bay_billing.cancel_requested && car.bay_billing.status !== 'ending'),
  );
  useReread(load, 10_000, watching);

  return (
    <div className="screen my-cars">
      <h1>My cars</h1>
      <ul className="card-grid" aria-label="My cars">
        {cars.map((car) => {
          const startup = startupLabel(car.startup);
          const billing = bayBillingLabel(car.bay_billing);
          const photoId = photos[car.id] ?? null;
          return (
            <li className="car-card" key={car.id}>
              <Link to={`/portal/cars/${car.id}`}>{car.name}</Link>
              <p className="mono">{cardBayLine(car)}</p>
              {startup === null ? null : <p>{startup}</p>}
              {photoId === null ? null : (
                <img src={`/api/photos/${photoId}/content`} alt="" className="card-photo" />
              )}
              {billing === null ? null : <p className="mono">{billing}</p>}
            </li>
          );
        })}
        {cars.length === 0 ? <li>No cars yet.</li> : null}
      </ul>
      <StatusRegion name="Car updates" status={status} />
    </div>
  );
}

export function PortalCarScreen({ carId }: { carId: string }): ReactNode {
  const { units } = useSession();
  const [car, setCar] = useState<CarDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const load = async (): Promise<void> => {
    const outcome = await api<{ car: CarDetail }>(`/api/cars/${carId}`);
    if (outcome.kind === 'error' && outcome.status === 404) {
      setMissing(true);
      return;
    }
    if (outcome.kind === 'ok') setCar(outcome.body.car);
    const invoiceOutcome = await api<{ invoices: Invoice[] }>('/api/invoices');
    if (invoiceOutcome.kind === 'ok') {
      setInvoices(invoiceOutcome.body.invoices.filter((invoice) => invoice.car.id === carId));
    }
  };

  useFirstLoad(load);
  useReread(load, 10_000, car !== null && car.open_release);

  if (missing) return <h1>{NOT_FOUND_HEADING}</h1>;
  if (car === null) return <p>Loading…</p>;

  return (
    <div className="screen portal-car">
      <header className="car-identity">
        <h1 className="display">{car.name}</h1>
        <p className="car-subline mono">
          {car.registration} · {car.colour}
        </p>
      </header>
      <section className="pane">
        <h2 className="pane-heading">Photos</h2>
        <ul className="photo-list" aria-label="Photos">
          {car.photos.map((photo) => (
            <li key={photo.id}>
              <img src={`/api/photos/${photo.id}/content`} alt="" />
            </li>
          ))}
        </ul>
      </section>
      <section className="pane">
        <h2 className="pane-heading">Condition report</h2>
        {car.condition_report === null ? (
          <p>No signed report yet.</p>
        ) : (
          <>
            <a href={`/api/condition-reports/${car.condition_report.id}/file`}>
              Download signed report
            </a>
            <p className="mono fingerprint">{car.condition_report.sha256}</p>
          </>
        )}
      </section>
      <section className="pane">
        <h2 className="pane-heading">Care history</h2>
        <ul className="entry-list">
          {car.care_entries.map((entry) => (
            <li key={entry.id}>
              <span className="mono">{momentLabel(new Date(entry.at))}</span> {entry.by.name}
              {entry.started ? <span className="chip">Start-up</span> : null}
              {entry.battery_v === null ? null : (
                <span className="mono"> {voltageReading(entry.battery_v)}</span>
              )}
              {entry.tyres_bar === null ? null : (
                <span className="mono">
                  {' '}
                  {[entry.tyres_bar.fl, entry.tyres_bar.fr, entry.tyres_bar.rl, entry.tyres_bar.rr]
                    .map((bar) => pressureReading(bar, units.pressure))
                    .join(' / ')}
                </span>
              )}
            </li>
          ))}
          {car.care_entries.length === 0 ? <li>No care entries yet.</li> : null}
        </ul>
      </section>
      <section className="pane">
        <h2 className="pane-heading">Jobs</h2>
        <ul className="entry-list">
          {car.jobs.map((job) => (
            <li key={job.id}>
              <Link to={`/portal/jobs/${job.id}`}>{job.number}</Link> {job.title}{' '}
              <span>{estimateLabel(job.status, null)}</span>
            </li>
          ))}
          {car.jobs.length === 0 ? <li>No jobs yet.</li> : null}
        </ul>
      </section>
      <section className="pane">
        <h2 className="pane-heading">Invoices</h2>
        <ul className="entry-list">
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link to={`/portal/invoices/${invoice.id}`}>{invoice.number}</Link>{' '}
              <span>{invoiceStatusLabel(invoice)}</span>
            </li>
          ))}
          {invoices.length === 0 ? <li>No invoices yet.</li> : null}
        </ul>
      </section>
      <section className="pane">
        <h2 className="pane-heading">Releases</h2>
        <ul className="entry-list">
          {car.releases.map((release) => (
            <li key={release.id}>
              <Link to={`/portal/releases/${release.id}`}>{release.slot_label}</Link>{' '}
              <span>{release.status}</span>
            </li>
          ))}
          {car.releases.length === 0 ? <li>No releases yet.</li> : null}
        </ul>
        {car.status === 'stored' && !car.open_release ? (
          <button type="button" onClick={() => navigate(`/portal/cars/${carId}/release`)}>
            Request release
          </button>
        ) : null}
      </section>
    </div>
  );
}

export function PortalJobScreen({ jobId }: { jobId: string }): ReactNode {
  const [job, setJob] = useState<Job | null>(null);
  const [coatStack, setCoatStack] = useState<CoatStackData | null>(null);
  const [missing, setMissing] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const status = useStatus();
  const ledgerHeading = useRef<HTMLHeadingElement | null>(null);
  const address = useCoatStackAddress(`/portal/jobs/${jobId}`, coatStack);

  const load = async (): Promise<void> => {
    const [jobOutcome, stackOutcome] = await Promise.all([
      api<{ job: Job }>(`/api/jobs/${jobId}`),
      api<CoatStackData>(`/api/jobs/${jobId}/coat-stack`),
    ]);
    if (jobOutcome.kind === 'error' && jobOutcome.status === 404) {
      setMissing(true);
      return;
    }
    if (jobOutcome.kind === 'ok') setJob(jobOutcome.body.job);
    if (stackOutcome.kind === 'ok') setCoatStack(stackOutcome.body);
  };

  useFirstLoad(load);
  useReread(load, 10_000, job?.status === 'sent');

  if (missing) return <h1>{NOT_FOUND_HEADING}</h1>;
  if (job === null || coatStack === null) return <p>Loading…</p>;

  return (
    <div className="screen job-page">
      <header className="car-identity">
        <h1 className="display">{job.car.name}</h1>
        <p className="car-subline mono">
          {job.number} · {job.title}
        </p>
      </header>
      <div className="three-panes">
        <CoatStackPanes
          jobId={jobId}
          data={coatStack}
          stageIndex={address.stageIndex}
          panelId={address.panelId}
          setStage={address.setStage}
          setPanel={address.setPanel}
          canOpenHistory
        />
        <section className="pane" aria-label="Job ledger">
          <h2 className="pane-heading" tabIndex={-1} ref={ledgerHeading}>
            Job ledger
          </h2>
          <p>
            <span className="label">Estimate</span> {estimateLabel(job.status, job.expires_at)}
          </p>
          <table className="data-table">
            <caption className="visually-hidden">Estimate lines</caption>
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col">Quantity</th>
                <th scope="col">Net</th>
                <th scope="col">VAT</th>
              </tr>
            </thead>
            <tbody>
              {job.lines.map((line) => (
                <tr key={line.id}>
                  <th scope="row">{line.description}</th>
                  <td className="mono">{`${line.quantity} × CHF ${line.unit_price}`}</td>
                  <td className="mono">{`CHF ${line.net}`}</td>
                  <td className="mono">{`CHF ${line.vat}`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="mono" colSpan={3}>{`CHF ${job.total}`}</td>
              </tr>
            </tfoot>
          </table>
          <h3>Stage log</h3>
          <ul className="entry-list">
            {job.stages.map((stage) => (
              <li key={stage.id}>
                {stage.name} <span className="mono">{timestampDateLabel(stage.logged_at)}</span>
              </li>
            ))}
            {job.stages.length === 0 ? <li>No stage logged yet.</li> : null}
          </ul>
          {job.status === 'sent' ? (
            <div className="row-actions">
              <ApproveButton jobId={jobId} job={job} status={status} onDone={load} />
              <button type="button" onClick={() => setDeclineOpen(true)}>
                Decline estimate
              </button>
            </div>
          ) : null}
        </section>
      </div>
      {declineOpen ? (
        <DeclineDialog
          jobId={jobId}
          job={job}
          status={status}
          onClose={() => setDeclineOpen(false)}
          onDone={() => {
            setDeclineOpen(false);
            void load();
          }}
          fallbackFocus={() => ledgerHeading.current}
        />
      ) : null}
      <StatusRegion name="Job updates" status={status} />
    </div>
  );
}

function ApproveButton({
  jobId,
  job,
  status,
  onDone,
}: {
  jobId: string;
  job: Job;
  status: StatusHandle;
  onDone(): Promise<void>;
}): ReactNode {
  const submit = useSubmit<{ job: Job }>({
    status,
    pendingText: 'Sending your answer...',
    onOk: () => {
      status.success(`Estimate approved. Work on your ${job.car.name} can begin.`);
      void onDone();
    },
    onError: (outcome) => {
      if (errorCode(outcome) === 'estimate_expired') {
        status.error(
          `This estimate expired on ${job.expires_at === null ? '' : timestampDateLabel(job.expires_at)} and can no longer be approved.`,
        );
        void onDone();
        return;
      }
      status.error('That could not be saved.');
    },
  });
  return (
    <button
      type="button"
      disabled={submit.busy}
      onClick={() => {
        void submit.run(() => api<{ job: Job }>(`/api/jobs/${jobId}/approve`, { body: {} }));
      }}
    >
      Approve estimate
    </button>
  );
}

function DeclineDialog({
  jobId,
  job,
  status,
  onClose,
  onDone,
  fallbackFocus,
}: {
  jobId: string;
  job: Job;
  status: StatusHandle;
  onClose: () => void;
  onDone(): void;
  fallbackFocus: () => HTMLElement | null;
}): ReactNode {
  // An expiry removes the opener, so focus lands on the Job ledger heading.
  const focusLedger = (): void => {
    window.setTimeout(() => fallbackFocus()?.focus(), 60);
  };
  const submit = useSubmit<{ job: Job }>({
    status,
    pendingText: 'Sending your answer...',
    onOk: () => {
      status.success('Estimate declined.');
      onDone();
    },
    onError: (outcome) => {
      if (errorCode(outcome) === 'estimate_expired') {
        status.error(
          `This estimate expired on ${job.expires_at === null ? '' : timestampDateLabel(job.expires_at)} and can no longer be answered.`,
        );
        onDone();
        focusLedger();
        return;
      }
      status.error('That could not be saved.');
    },
  });

  return (
    <Dialog name="Decline estimate?" onClose={onClose} fallbackFocus={fallbackFocus}>
      <div className="row-actions">
        <button
          type="button"
          className="primary"
          disabled={submit.busy}
          onClick={() => {
            void submit.run(() => api<{ job: Job }>(`/api/jobs/${jobId}/decline`, { body: {} }));
          }}
        >
          Decline
        </button>
        <button type="button" onClick={onClose}>
          Keep estimate
        </button>
      </div>
    </Dialog>
  );
}

export function PortalInvoiceScreen({ invoiceId }: { invoiceId: string }): ReactNode {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [missing, setMissing] = useState(false);
  const status = useStatus();
  const previous = useRef<{ balance: string; status: string } | null>(null);

  const load = async (): Promise<void> => {
    const outcome = await api<{ invoice: Invoice }>(`/api/invoices/${invoiceId}`);
    if (outcome.kind === 'error' && outcome.status === 404) {
      setMissing(true);
      return;
    }
    if (outcome.kind !== 'ok') return;
    const next = outcome.body.invoice;
    const before = previous.current;
    previous.current = { balance: next.balance, status: next.status };
    if (before !== null && (before.balance !== next.balance || before.status !== next.status)) {
      if (next.status === 'paid') {
        status.announceOnce(`paid:${next.balance}`, `Invoice ${next.number} is paid.`);
      } else if (before.status === 'paid') {
        status.announceOnce(
          `unpaid-again:${next.balance}`,
          `Invoice ${next.number} is awaiting payment again. CHF ${next.balance} outstanding.`,
        );
      } else {
        status.announceOnce(
          `balance:${next.balance}`,
          `Payment received. CHF ${next.balance} outstanding.`,
        );
      }
    }
    setInvoice(next);
  };

  useFirstLoad(load);
  useReread(load, 10_000);

  if (missing) return <h1>{NOT_FOUND_HEADING}</h1>;
  if (invoice === null) return <p>Loading…</p>;

  return (
    <div className="screen portal-invoice">
      <h1>{invoice.number}</h1>
      <p>{invoice.car.name}</p>
      <table className="data-table">
        <caption className="visually-hidden">Invoice lines</caption>
        <thead>
          <tr>
            <th scope="col">Description</th>
            <th scope="col">Quantity</th>
            <th scope="col">Net</th>
            <th scope="col">VAT</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <th scope="row">{line.description}</th>
              <td className="mono">{line.quantity}</td>
              <td className="mono">{`CHF ${line.net}`}</td>
              <td className="mono">{`CHF ${line.vat}`}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="mono" colSpan={3}>{`CHF ${invoice.total}`}</td>
          </tr>
        </tfoot>
      </table>
      <p>{invoiceStatusLabel(invoice)}</p>
      {invoice.status === 'paid' ? null : (
        <p>
          <span className="label">Outstanding</span>{' '}
          <span className="mono">{outstandingLine(invoice)}</span>
        </p>
      )}
      <StatusRegion name="Invoice updates" status={status} />
    </div>
  );
}

export function RequestReleaseScreen({ carId }: { carId: string }): ReactNode {
  const status = useStatus();
  const [earliest, setEarliest] = useState<{ earliest: string; earliest_label: string } | null>(
    null,
  );
  const [date, setDate] = useState('');
  const [time, setTime] = useState('08:00');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Release | null>(null);

  const loadSlot = async (): Promise<void> => {
    const outcome = await api<{ earliest: string; earliest_label: string }>(
      '/api/releases/earliest-slot',
    );
    if (outcome.kind !== 'ok') return;
    setEarliest(outcome.body);
    setDate((current) => (current === '' ? outcome.body.earliest.slice(0, 10) : current));
    setTime((current) =>
      current === '08:00' ? outcome.body.earliest.slice(11, 16) : current,
    );
  };

  useFirstLoad(loadSlot);
  useReread(loadSlot, 60_000);

  const submit = useSubmit<{ release: Release }>({
    status,
    pendingText: 'Requesting release...',
    idempotent: true,
    noAnswerText: NO_ANSWER.requestRelease,
    onOk: (body) => {
      setDone(body.release);
      status.success(
        `We'll confirm ${body.release.slot_label} by email once the concierge books it.`,
      );
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      if (code === 'slot_taken') status.error('That slot was just taken. Choose another.');
      else if (code === 'release_already_open') {
        status.error('This car already has an open release.');
      } else if (code === 'car_in_workshop') {
        status.error("This car is in the workshop and can't be released yet.");
      } else if (code === 'car_not_stored') status.error('This car is not in a bay.');
      else if (code === 'idempotency_conflict') status.error(IDEMPOTENCY_CONFLICT);
      else if (outcome.kind === 'error' && outcome.status === 422) {
        setErrors(fieldErrors(outcome.body));
        status.error('Check the form and try again.');
      } else status.error('That could not be requested.');
    },
  });

  const summary: FieldError[] = Object.entries(errors).map(([field, message]) => ({
    field,
    message,
    inputId: `release-${field}`,
  }));

  if (done !== null) {
    return (
      <div className="screen request-release">
        <h1>We&apos;ve received your release request</h1>
        <p>{`We'll confirm ${done.slot_label} by email once the concierge books it.`}</p>
        <Link to={`/portal/releases/${done.id}`}>View release</Link>
        <StatusRegion name="Release updates" status={status} />
      </div>
    );
  }

  return (
    <div className="screen request-release">
      <h1>Request release</h1>
      <ErrorSummary errors={summary} />
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          void submit.run((key) =>
            api<{ release: Release }>('/api/releases', {
              idempotencyKey: key,
              body: { car_id: carId, slot: `${date}T${time}` },
            }),
          );
        }}
      >
        <label htmlFor="release-date">Date</label>
        <input
          id="release-date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          placeholder="YYYY-MM-DD"
        />
        <label htmlFor="release-time">Time</label>
        <select
          id="release-time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        >
          {slotTimeOptions().map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <FieldMessage id="release-slot-error" message={errors.slot} />
        <p>{`Earliest slot: ${earliest?.earliest_label ?? ''}`}</p>
        <button type="submit" className="primary" disabled={submit.busy}>
          Request release
        </button>
      </form>
      <StatusRegion name="Release updates" status={status} />
    </div>
  );
}

export function PortalReleaseScreen({ releaseId }: { releaseId: string }): ReactNode {
  const status = useStatus();
  const [release, setRelease] = useState<Release | null>(null);
  const [missing, setMissing] = useState(false);
  const previous = useRef<string | null>(null);

  const load = async (): Promise<void> => {
    const outcome = await api<{ release: Release }>(`/api/releases/${releaseId}`);
    if (outcome.kind === 'error' && outcome.status === 404) {
      setMissing(true);
      return;
    }
    if (outcome.kind !== 'ok') return;
    const next = outcome.body.release;
    const before = previous.current;
    previous.current = next.status;
    if (before !== null && before !== next.status) {
      const announcement = releaseAnnouncement(next.status, next.slot);
      if (announcement !== null) status.announceOnce(`release:${next.status}`, announcement);
    }
    setRelease(next);
  };

  useFirstLoad(load);
  useReread(load, 10_000);

  const cancel = useSubmit<{ release: Release }>({
    status,
    pendingText: 'Saving...',
    onOk: () => {
      status.success('Release cancelled.');
      previous.current = 'cancelled';
      void load();
    },
    onError: () => status.error('That could not be saved.'),
  });

  if (missing) return <h1>{NOT_FOUND_HEADING}</h1>;
  if (release === null) return <p>Loading…</p>;

  const held = release.held_by.length > 0 && release.status === 'staged';

  return (
    <div className="screen portal-release">
      <h1>{RELEASE_HEADING[release.status]}</h1>
      {held ? (
        <p className="hold-label">
          <AlertMark />
          {holdLine(release.held_by.map((invoice) => invoice.number))}
        </p>
      ) : null}
      <p className="mono">{release.slot_label}</p>
      <p className="mono">{release.bay_code ?? '—'}</p>
      <ul className="entry-list">
        {release.events.map((event, index) => (
          <li key={`${event.status}-${String(index)}`}>
            {event.status} <span className="mono">{momentLabel(new Date(event.at))}</span>{' '}
            {event.by.name}
          </li>
        ))}
      </ul>
      {releaseActionAllowed(release.status, 'cancel', 'owner') ? (
        <button
          type="button"
          disabled={cancel.busy}
          onClick={() => {
            void cancel.run(() =>
              api<{ release: Release }>(`/api/releases/${releaseId}/cancel`, { body: {} }),
            );
          }}
        >
          Cancel release
        </button>
      ) : null}
      <StatusRegion name="Release updates" status={status} />
    </div>
  );
}
