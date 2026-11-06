// The job page, staff and portal (brief: Screens and layout › Job page; Interactions › Estimate
// versions, Estimate answers on the job page, Estimate expiry on the portal job page). Three panes:
// Car plan, Cross-section and Job ledger. The ledger shows only the actions legal for the job's
// current server status.
import { useEffect, useRef, useState } from "react";
import { jobActionAllowed } from "../../shared/transitions.js";
import type { CarDetail, CoatStack, Invoice, Job, Photo, Reading } from "../../shared/api.js";
import { LINE_KIND_LABEL, PANELS, PANEL_NAME, STAGES, type PanelId } from "../../shared/domain.js";
import { FILM_SYMBOL, formatFilm } from "../../shared/units.js";
import { formatMoment, formatTimestampDay } from "../../shared/zurich.js";
import { HttpError, Interrupted, NoAnswer, errorCode, get, request } from "../api.js";
import { CoatStackPanes } from "../coatstack/CoatStack.js";
import { EstimateDialog } from "../EstimateDialog.js";
import { applyInPlace, useIdempotencyKey, usePoll } from "../hooks.js";
import {
  IDEMPOTENCY_CONFLICT,
  JOB_MOVED_ON,
  NO_ANSWER,
  SIGNED_IN_AGAIN,
  chf,
  estimateLabel,
  invoiceStatusLabel,
  outstandingLine,
} from "../labels.js";
import { Icon } from "../ui/Icon.js";
import { NotFound } from "../ui/NotFound.js";
import { useSession } from "../session.js";
import { Link } from "../Shell.js";
import { Dialog } from "../ui/Dialog.js";
import { ErrorSummary, FieldError, StatusRegion, summaryOf, useNote } from "../ui/Feedback.js";
import { ProgressBar, UploadField } from "../ui/Upload.js";

interface Loaded {
  job: Job;
  stack: CoatStack;
}

async function readJob(jobId: string, firstLoad = false): Promise<Job> {
  return (await get<{ job: Job }>(`/api/jobs/${jobId}`, firstLoad)).job;
}

export function JobPage({ jobId, portal }: { jobId: string; portal: boolean }): JSX.Element {
  const { user, units } = useSession();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [jobNote, sayJob] = useNote();
  const [uploadNote, sayUpload] = useNote();
  const [invoiceNote] = useNote();
  const [progress, setProgress] = useState<number | null>(null);
  const [dialog, setDialog] = useState<"estimate" | "stage" | "reading" | "decline" | null>(null);
  const [history, setHistory] = useState<PanelId | null>(null);
  const [latest, setLatest] = useState(0);
  const ledgerHeading = useRef<HTMLHeadingElement>(null);
  const invoiceKey = useIdempotencyKey();
  const workshop = !portal && (user.role === "workshop_lead" || user.role === "house_manager");

  const loadStack = async (): Promise<CoatStack> => get<CoatStack>(`/api/jobs/${jobId}/coat-stack`);
  const loadPhotos = (carId: string): void => {
    get<{ car: CarDetail }>(`/api/cars/${carId}`).then(
      (answer) => setPhotos(answer.car.photos.filter((photo) => photo.job_id === jobId)),
      () => undefined,
    );
  };

  useEffect(() => {
    Promise.all([readJob(jobId, true), loadStack()]).then(
      ([job, stack]) => {
        setLoaded({ job, stack });
        loadPhotos(job.car.id);
      },
      () => setMissing(true),
    );
  }, [jobId]);

  const job = loaded?.job ?? null;

  useEffect(() => {
    if (!job?.invoice_id) return;
    get<{ invoice: Invoice }>(`/api/invoices/${job.invoice_id}`).then((answer) => setInvoice(answer.invoice), () => undefined);
  }, [job?.invoice_id]);

  // Re-read the job while the owner may still answer the estimate.
  usePoll(
    async () => {
      if (!loaded) return;
      const fresh = await readJob(jobId);
      if (fresh.status === loaded.job.status && fresh.version === loaded.job.version) return;
      const was = loaded.job.status;
      applyInPlace(
        () => setLoaded({ ...loaded, job: fresh }),
        () => ledgerHeading.current,
      );
      if (portal || was !== "sent") return;
      if (fresh.status === "approved") sayJob(`${fresh.owner.name} approved estimate ${fresh.number}.`);
      if (fresh.status === "declined") sayJob(`${fresh.owner.name} declined estimate ${fresh.number}.`);
      if (fresh.status === "expired") sayJob(`Estimate ${fresh.number} expired on ${fresh.expires_at ? formatTimestampDay(fresh.expires_at) : ""}.`);
    },
    10_000,
    job?.status === "sent",
  );

  // Re-read the invoice of an invoiced or paid job.
  usePoll(
    async () => {
      if (!job?.invoice_id) return;
      const fresh = (await get<{ invoice: Invoice }>(`/api/invoices/${job.invoice_id}`)).invoice;
      if (JSON.stringify(fresh) !== JSON.stringify(invoice)) applyInPlace(() => setInvoice(fresh));
    },
    10_000,
    job?.status === "invoiced" || job?.status === "paid",
  );

  if (missing) return <NotFound />;
  if (!loaded || !job) return <div className="screen placeholder" aria-hidden="true" />;

  const setJob = (next: Job): void => setLoaded({ ...loaded, job: next });
  const refreshStack = async (): Promise<void> => {
    const [fresh, stack] = await Promise.all([readJob(jobId), loadStack()]);
    setLoaded({ job: fresh, stack });
  };

  const act = async (path: string, success: (next: Job) => string, ifMatch?: number): Promise<void> => {
    sayJob("Saving...");
    try {
      const answer = await request<{ job: Job }>(`/api/jobs/${job.id}/${path}`, { method: "POST", ifMatch });
      setJob(answer.data.job);
      sayJob(success(answer.data.job));
    } catch (error) {
      const code = errorCode(error);
      if (code === "invalid_transition") sayJob(JOB_MOVED_ON, "error");
      else if (code === "estimate_changed")
        sayJob(`Estimate ${job.number} was changed by someone else. Your edits are kept; reload to see the latest.`, "error");
      else if (error instanceof Interrupted) sayJob(SIGNED_IN_AGAIN);
      else if (error instanceof NoAnswer) sayJob("No answer from the server. Nothing was saved; press again.", "error");
      else if (error instanceof HttpError) sayJob(Object.values(error.fields)[0] ?? JOB_MOVED_ON, "error");
    }
  };

  const issueInvoice = async (): Promise<void> => {
    sayJob("Issuing invoice...");
    try {
      const answer = await request<{ invoice: Invoice; job: Job }>(`/api/jobs/${job.id}/invoice`, {
        method: "POST",
        idempotencyKey: invoiceKey.take(),
      });
      invoiceKey.discard();
      setInvoice(answer.data.invoice);
      setJob(answer.data.job);
      sayJob(`Invoice ${answer.data.invoice.number} issued for ${chf(answer.data.invoice.total)}.`);
    } catch (error) {
      if (error instanceof NoAnswer) {
        sayJob(NO_ANSWER.invoice, "error");
        return;
      }
      invoiceKey.discard();
      const code = errorCode(error);
      if (code === "invalid_transition") sayJob(JOB_MOVED_ON, "error");
      else if (code === "billing_unavailable") sayJob("Billing is unreachable. The invoice was not issued; try again when the notice clears.", "error");
      else if (code === "idempotency_conflict") sayJob(IDEMPOTENCY_CONFLICT, "error");
    }
  };

  const answerEstimate = async (verb: "approve" | "decline"): Promise<void> => {
    sayJob("Sending your answer...");
    try {
      const answer = await request<{ job: Job }>(`/api/jobs/${job.id}/${verb}`, { method: "POST" });
      setDialog(null);
      setJob(answer.data.job);
      sayJob(verb === "approve" ? `Estimate approved. Work on your ${job.car.name} can begin.` : "Estimate declined.");
    } catch (error) {
      const code = errorCode(error);
      setDialog(null);
      if (code === "estimate_expired") {
        const day = job.expires_at ? formatTimestampDay(job.expires_at) : "";
        sayJob(`This estimate expired on ${day} and can no longer be ${verb === "approve" ? "approved" : "answered"}.`, "error");
        void readJob(jobId).then(setJob, () => undefined);
      } else if (code === "invalid_transition") sayJob(JOB_MOVED_ON, "error");
      else if (error instanceof Interrupted) sayJob(SIGNED_IN_AGAIN);
      else if (error instanceof NoAnswer) sayJob("No answer from the server. Nothing was sent; press again.", "error");
    }
  };

  const status = job.status;
  const actions: JSX.Element[] = [];
  const button = (label: string, onClick: () => void, primary = false): JSX.Element => (
    <button key={label} type="button" className={primary ? "button primary" : "button"} onClick={onClick}>
      {label}
    </button>
  );
  if (workshop) {
    if (jobActionAllowed("edit", status)) {
      actions.push(button("Edit estimate", () => setDialog("estimate")));
      if (jobActionAllowed("send", status) && job.lines.length > 0)
        actions.push(button("Send to owner", () => void act("send", (next) => `Estimate ${next.number} sent to ${next.owner.name}.`, job.version), true));
    }
    if (jobActionAllowed("revise", status))
      actions.push(button("Revise estimate", () => void act("revise", (next) => `Estimate ${next.number} is a draft again.`)));
    if (jobActionAllowed("log_stage", status)) actions.push(button("Log stage", () => setDialog("stage"), true));
    if (jobActionAllowed("add_reading", status) && job.stages.length > 0) actions.push(button("Add reading", () => setDialog("reading")));
    if (jobActionAllowed("finish", status) && job.stages.length > 0) {
      actions.push(button("Mark finished", () => void act("finish", (next) => `Job ${next.number} marked finished.`)));
    }
    if (jobActionAllowed("issue_invoice", status)) actions.push(button("Issue invoice", () => void issueInvoice(), true));
  }
  if (portal && jobActionAllowed("answer", status)) {
    actions.push(button("Approve estimate", () => void answerEstimate("approve"), true));
    actions.push(button("Decline estimate", () => setDialog("decline")));
  }
  const stagePhotos = workshop && jobActionAllowed("log_stage", status);

  return (
    <div className="screen job-screen">
      <header className="car-identity">
        <h1 className="identity">{job.car.name}</h1>
        <p className="identity-sub">
          <span className="mono-text">{job.number}</span> · {job.title}
          {portal ? null : (
            <>
              {" · "}
              <Link to={`/cars/${job.car.id}`}>Car page</Link>
            </>
          )}
        </p>
      </header>
      <div className="panes">
        <CoatStackPanes data={loaded.stack} unit={units.film} onOpenHistory={setHistory} latestOnChange={latest} />
        <section className="pane" aria-labelledby="job-ledger-heading">
          <h2 id="job-ledger-heading" ref={ledgerHeading} tabIndex={-1} className="pane-heading">
            Job ledger
          </h2>
          <StatusRegion name="Job updates" note={jobNote} />
          <p className="estimate-status">
            <span className="sub">Estimate</span>
            <span className="badge" role="group" aria-label="Estimate">
              {estimateLabel(job)}
            </span>
          </p>
          <EstimateLines job={job} />
          {actions.length ? <div className="ledger-actions">{actions}</div> : null}
          <h3 className="section-heading">Stage log</h3>
          {job.stages.length === 0 ? (
            <p className="empty">No stage logged yet.</p>
          ) : (
            <ol className="stage-log">
              {job.stages.map((entry) => (
                <li key={entry.id}>
                  <span className="display-label stage-log-name">{entry.name}</span>
                  <span className="mono-text stage-log-moment">{formatMoment(entry.logged_at)}</span>
                  <span className="sub stage-log-count">{`${entry.readings_count} readings`}</span>
                </li>
              ))}
            </ol>
          )}
          <h3 className="section-heading">Stage photos</h3>
          <StatusRegion name="Upload updates" note={uploadNote} />
          <ProgressBar value={progress} />
          <ul aria-label="Photos" className="photo-list">
            {photos.map((photo) => (
              <li key={photo.id}>
                <img src={`/api/photos/${photo.id}/content`} alt={`Stage photo, ${formatMoment(photo.created_at)}`} loading="lazy" />
              </li>
            ))}
          </ul>
          {photos.length === 0 ? (
            <p className="empty empty-drawn">
              <Icon name="image" size={32} />
              No stage photos yet.
            </p>
          ) : null}
          {stagePhotos ? (
            <UploadField<{ photo: Photo }>
              label="Stage photo"
              button="Upload stage photo"
              accept="image/jpeg,image/png"
              path={`/api/cars/${job.car.id}/photos`}
              fields={[
                ["kind", "stage"],
                ["job_id", job.id],
              ]}
              pending={(name) => `Uploading ${name}...`}
              success={`Photo attached to ${job.car.name}.`}
              say={sayUpload}
              progress={{ value: progress, set: setProgress }}
              onStored={(answer) => setPhotos([...photos, answer.photo])}
            />
          ) : null}
          {invoice ? (
            <div className="invoice-block">
              <h3 className="section-heading">Invoice</h3>
              <StatusRegion name="Invoice updates" note={invoiceNote} />
              <p>
                <span className="mono-text">{invoice.number}</span> · <span>{invoiceStatusLabel(invoice)}</span>
              </p>
              {invoice.status === "awaiting_payment" ? (
                <p className="outstanding mono-text" role="group" aria-label="Outstanding">
                  {outstandingLine(invoice)}
                </p>
              ) : null}
              {portal ? <Link to={`/portal/invoices/${invoice.id}`}>Open invoice</Link> : null}
            </div>
          ) : null}
        </section>
      </div>
      {dialog === "estimate" ? (
        <EstimateDialog
          job={job}
          say={sayJob}
          onClose={() => setDialog(null)}
          onSaved={(next) => {
            setDialog(null);
            setJob(next);
          }}
        />
      ) : null}
      {dialog === "stage" ? (
        <LogStage
          job={job}
          say={sayJob}
          onClose={() => setDialog(null)}
          onLogged={() => {
            setDialog(null);
            void refreshStack().then(() => setLatest((n) => n + 1), () => undefined);
          }}
        />
      ) : null}
      {dialog === "reading" ? (
        <AddReading
          job={job}
          say={sayJob}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void refreshStack().catch(() => undefined);
          }}
        />
      ) : null}
      {dialog === "decline" ? (
        <Dialog title="Decline estimate?" onClose={() => setDialog(null)} fallbackFocus={() => ledgerHeading.current}>
          <p>{`Declining tells the house not to start work on your ${job.car.name}. The house can revise the estimate and send it again.`}</p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setDialog(null)}>
              Keep estimate
            </button>
            <button type="button" className="button primary" onClick={() => void answerEstimate("decline")}>
              Decline
            </button>
          </div>
        </Dialog>
      ) : null}
      {history ? <ReadingHistory jobId={job.id} panel={history} onClose={() => setHistory(null)} /> : null}
    </div>
  );
}

function EstimateLines({ job }: { job: Job }): JSX.Element {
  return (
    <>
      <table aria-label="Estimate lines" className="table lines-table">
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col" className="numeric">
              Qty
            </th>
            <th scope="col" className="numeric">
              Net
            </th>
          </tr>
        </thead>
        <tbody>
          {job.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.description}
                <span className="sub">
                  {`${LINE_KIND_LABEL[line.kind]} · `}
                  <span className="mono-text">{chf(line.unit_price)}</span>
                </span>
              </td>
              <td className="numeric mono-text">{line.quantity}</td>
              <td className="numeric mono-text line-net">{chf(line.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="totals">
        <div>
          <dt>Net</dt>
          <dd className="mono-text">{chf(job.net_total)}</dd>
        </div>
        <div>
          <dt>VAT 8.1%</dt>
          <dd className="mono-text">{chf(job.vat_total)}</dd>
        </div>
        <div>
          <dt>Rounding</dt>
          <dd className="mono-text">{chf(job.rounding)}</dd>
        </div>
        <div className="total-row">
          <dt>Total</dt>
          <dd className="mono-text">{chf(job.total)}</dd>
        </div>
      </dl>
    </>
  );
}

function stageError(error: unknown, stage: string): string {
  const code = errorCode(error);
  if (code === "stage_already_logged") return `${stage} is already logged for this job.`;
  if (code === "stage_out_of_order") return `${stage} can't be logged after a later stage.`;
  if (code === "invalid_transition") return JOB_MOVED_ON;
  if (error instanceof Interrupted) return SIGNED_IN_AGAIN;
  if (error instanceof NoAnswer) return "No answer from the server. Nothing was saved; press again.";
  if (error instanceof HttpError) return Object.values(error.fields)[0] ?? "";
  return "";
}

function LogStage({ job, say, onClose, onLogged }: { job: Job; say: (text: string, tone?: "info" | "error") => void; onClose: () => void; onLogged: () => void }): JSX.Element {
  const { units } = useSession();
  const logged = new Set(job.stages.map((entry) => entry.name));
  const [stage, setStage] = useState<string>(STAGES.find((name) => !logged.has(name)) ?? STAGES[0]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<PanelId[]>([]);

  const save = async (): Promise<void> => {
    say("Saving stage...");
    const filled = PANELS.filter((panel) => (values[panel.id] ?? "").trim() !== "");
    setSent(filled.map((panel) => panel.id));
    try {
      const answer = await request<{ stage: { readings_count: number } }>(`/api/jobs/${job.id}/stages`, {
        method: "POST",
        body: { name: stage, readings: filled.map((panel) => ({ panel: panel.id, value: values[panel.id]?.trim(), unit: units.film })) },
      });
      onLogged();
      say(`${stage} logged with ${answer.data.stage.readings_count} readings.`);
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) setErrors(error.fields);
      say(stageError(error, stage), "error");
    }
  };

  const idFor = (field: string): string => {
    const index = /^readings\[(\d+)\]/.exec(field);
    if (index) return `stage-reading-${sent[Number(index[1])] ?? "bonnet"}`;
    return field === "name" ? "stage-name" : "stage-reading-front_valance";
  };
  const errorFor = (panel: PanelId): string | undefined => {
    const index = sent.indexOf(panel);
    return index < 0 ? undefined : errors[`readings[${index}].value`] ?? errors[`readings[${index}].panel`];
  };

  return (
    <Dialog title="Log stage" onClose={onClose} wide>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorSummary items={summaryOf(errors, ["name", "readings"])} idFor={idFor} />
        <div className="field">
          <label htmlFor="stage-name">Stage</label>
          <select id="stage-name" value={stage} onChange={(event) => setStage(event.target.value)}>
            {STAGES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <FieldError id="stage-name-error" message={errors.name} />
        </div>
        <p className="sub">{`Readings in ${FILM_SYMBOL[units.film]}. Leave a panel empty when it was not measured.`}</p>
        <FieldError id="stage-readings-error" message={errors.readings} />
        <div className="form-grid readings-grid">
          {PANELS.map((panel) => (
            <div className="field" key={panel.id}>
              <label htmlFor={`stage-reading-${panel.id}`}>{`${panel.name} reading`}</label>
              <input
                id={`stage-reading-${panel.id}`}
                type="text"
                inputMode="decimal"
                value={values[panel.id] ?? ""}
                onChange={(event) => setValues({ ...values, [panel.id]: event.target.value })}
              />
              <FieldError id={`stage-reading-${panel.id}-error`} message={errorFor(panel.id)} />
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Save stage
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AddReading({ job, say, onClose, onSaved }: { job: Job; say: (text: string, tone?: "info" | "error") => void; onClose: () => void; onSaved: () => void }): JSX.Element {
  const { units } = useSession();
  const [stageId, setStageId] = useState(job.stages[job.stages.length - 1]?.id ?? "");
  const [panel, setPanel] = useState<PanelId>("bonnet");
  const [value, setValue] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async (): Promise<void> => {
    say("Saving reading...");
    try {
      const answer = await request<{ reading: Reading }>(`/api/jobs/${job.id}/stages/${stageId}/readings`, {
        method: "POST",
        body: { panel, value: value.trim(), unit: units.film },
      });
      onSaved();
      say(`Reading saved: ${PANEL_NAME[panel]} ${formatFilm(answer.data.reading.film_um, units.film)}.`);
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) setErrors(error.fields);
      say(stageError(error, ""), "error");
    }
  };

  return (
    <Dialog title="Add reading" onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorSummary items={summaryOf(errors, ["panel", "value"])} idFor={(field) => `reading-${field}`} />
        <div className="field">
          <label htmlFor="reading-stage">Logged stage</label>
          <select id="reading-stage" value={stageId} onChange={(event) => setStageId(event.target.value)}>
            {job.stages.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="reading-panel">Panel</label>
          <select id="reading-panel" value={panel} onChange={(event) => setPanel(event.target.value as PanelId)}>
            {PANELS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <FieldError id="reading-panel-error" message={errors.panel} />
        </div>
        <div className="field">
          <label htmlFor="reading-value">Reading</label>
          <input id="reading-value" type="text" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
          <p className="sub">{FILM_SYMBOL[units.film]}</p>
          <FieldError id="reading-value-error" message={errors.value} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Save reading
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ReadingHistory({ jobId, panel, onClose }: { jobId: string; panel: PanelId; onClose: () => void }): JSX.Element {
  const { units } = useSession();
  const [readings, setReadings] = useState<Reading[] | null>(null);
  useEffect(() => {
    get<{ readings: Reading[] }>(`/api/jobs/${jobId}/panels/${panel}/readings`).then((answer) => setReadings(answer.readings), () => setReadings([]));
  }, [jobId, panel]);
  return (
    <Dialog title={`Reading history: ${PANEL_NAME[panel]}`} onClose={onClose}>
      {readings === null ? (
        <p className="placeholder" aria-hidden="true" />
      ) : readings.length === 0 ? (
        <p className="empty">No readings for this panel yet.</p>
      ) : (
        <table className="table" aria-label="Readings">
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col" className="numeric">
                Reading
              </th>
              <th scope="col">Logged</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.stage}</td>
                <td className="numeric mono-text">{formatFilm(entry.film_um, units.film)}</td>
                <td>
                  <span className="mono-text">{formatMoment(entry.logged_at)}</span>
                  <span className="sub">{entry.logged_by.name}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
