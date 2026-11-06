import { useRef, useState, type ReactNode } from 'react';
import type { CoatStack as CoatStackData } from '../../shared/coatstack';
import { PANELS, panelName, type PanelId } from '../../shared/panels';
import { STAGE_NAMES, type StageName } from '../../shared/stages';
import { FILM_UNIT_LABEL, filmReading } from '../../shared/units';
import { jobActionAllowed } from '../../shared/jobstates';
import type { Invoice, Job, Photo } from '../../shared/types';
import {
  IDEMPOTENCY_CONFLICT,
  MOVED_ON,
  NOT_FOUND_HEADING,
  NO_ANSWER,
  STORAGE_DOWN_UPLOAD,
  UPLOAD_CUT_OFF,
  UPLOAD_TOO_LARGE,
  estimateLabel,
  invoiceStatusLabel,
  outstandingLine,
  timestampDateLabel,
} from '../copy';
import { api, errorCode, fieldErrors, upload } from '../lib/api';
import {
  useFirstLoad,
  useReread,
  useStatus,
  useSubmit,
  type StatusHandle,
} from '../lib/hooks';
import { useSession } from '../lib/session';
import { Dialog } from '../components/Dialog';
import { ErrorSummary, FieldMessage, StatusRegion, type FieldError } from '../components/Status';
import { CoatStackPanes, useCoatStackAddress } from './JobPanes';
import { EstimateDialog } from './EstimateDialog';

type OpenDialog = 'none' | 'estimate' | 'stage' | 'reading';

export function JobPageScreen({ jobId }: { jobId: string }): ReactNode {
  const { units } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [coatStack, setCoatStack] = useState<CoatStackData | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog>('none');
  const jobStatus = useStatus();
  const uploadStatus = useStatus();
  const invoiceStatus = useStatus();
  const ledgerHeading = useRef<HTMLHeadingElement | null>(null);
  const lastStatus = useRef<string | null>(null);

  const address = useCoatStackAddress(`/jobs/${jobId}`, coatStack);

  const load = async (): Promise<void> => {
    const [jobOutcome, stackOutcome] = await Promise.all([
      api<{ job: Job }>(`/api/jobs/${jobId}`),
      api<CoatStackData>(`/api/jobs/${jobId}/coat-stack`),
    ]);
    if (jobOutcome.kind === 'error' && jobOutcome.status === 404) {
      setMissing(true);
      return;
    }
    if (jobOutcome.kind === 'ok') {
      const next = jobOutcome.body.job;
      announceChange(next);
      setJob(next);
      if (next.invoice_id !== null) {
        const invoiceOutcome = await api<{ invoice: Invoice }>(`/api/invoices/${next.invoice_id}`);
        if (invoiceOutcome.kind === 'ok') setInvoice(invoiceOutcome.body.invoice);
      }
      const carOutcome = await api<{ car: { photos: Photo[] } }>(`/api/cars/${next.car.id}`);
      if (carOutcome.kind === 'ok') {
        setPhotos(carOutcome.body.car.photos.filter((photo) => photo.job_id === jobId));
      }
    }
    if (stackOutcome.kind === 'ok') setCoatStack(stackOutcome.body);
  };

  const announceChange = (next: Job): void => {
    const previous = lastStatus.current;
    lastStatus.current = next.status;
    if (previous === null || previous === next.status) return;
    if (next.status === 'approved') {
      jobStatus.announceOnce(
        `job:${next.status}:${String(next.version)}`,
        `${next.owner.name} approved estimate ${next.number}.`,
      );
    } else if (next.status === 'declined') {
      jobStatus.announceOnce(
        `job:${next.status}:${String(next.version)}`,
        `${next.owner.name} declined estimate ${next.number}.`,
      );
    } else if (next.status === 'expired' && next.expires_at !== null) {
      jobStatus.announceOnce(
        `job:${next.status}`,
        `Estimate ${next.number} expired on ${timestampDateLabel(next.expires_at)}.`,
      );
    }
  };

  useFirstLoad(load);
  useReread(load, 10_000, job?.status === 'sent');
  useReread(
    async () => {
      if (job?.invoice_id === null || job === null) return;
      const outcome = await api<{ invoice: Invoice }>(`/api/invoices/${job.invoice_id ?? ''}`);
      if (outcome.kind === 'ok') setInvoice(outcome.body.invoice);
    },
    10_000,
    job !== null && job.invoice_id !== null,
  );

  if (missing) return <h1>{NOT_FOUND_HEADING}</h1>;
  if (job === null || coatStack === null) return <p>Loading…</p>;

  const shape = {
    status: job.status,
    lineCount: job.lines.length,
    stageCount: job.stages.length,
  };

  const afterAction = (next: Job): void => {
    lastStatus.current = next.status;
    setJob(next);
    void load();
  };

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
            <span className="label">Estimate</span>{' '}
            <span>{estimateLabel(job.status, job.expires_at)}</span>
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
                <th scope="row">Net total</th>
                <td className="mono" colSpan={3}>{`CHF ${job.net_total}`}</td>
              </tr>
              <tr>
                <th scope="row">VAT</th>
                <td className="mono" colSpan={3}>{`CHF ${job.vat_total}`}</td>
              </tr>
              <tr>
                <th scope="row">Rounding</th>
                <td className="mono" colSpan={3}>{`CHF ${job.rounding}`}</td>
              </tr>
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
                <span>{stage.name}</span>{' '}
                <span className="mono">{timestampDateLabel(stage.logged_at)}</span>{' '}
                <span className="mono">{`${String(stage.readings_count)} readings`}</span>
              </li>
            ))}
            {job.stages.length === 0 ? <li>No stage logged yet.</li> : null}
          </ul>

          <h3>Stage photos</h3>
          <ul className="photo-list" aria-label="Stage photos">
            {photos.map((photo) => (
              <li key={photo.id}>
                <img src={`/api/photos/${photo.id}/content`} alt="" />
              </li>
            ))}
          </ul>
          {jobActionAllowed(shape, 'stage_photo') ? (
            <StagePhotoUpload
              jobId={jobId}
              carId={job.car.id}
              carName={job.car.name}
              status={uploadStatus}
              onStored={load}
            />
          ) : null}

          <div className="ledger-actions">
            {jobActionAllowed(shape, 'edit') ? (
              <button type="button" onClick={() => setDialog('estimate')}>
                Edit estimate
              </button>
            ) : null}
            {jobActionAllowed(shape, 'send') ? (
              <SendButton job={job} status={jobStatus} onDone={afterAction} />
            ) : null}
            {jobActionAllowed(shape, 'revise') ? (
              <PlainAction
                label="Revise estimate"
                path={`/api/jobs/${jobId}/revise`}
                status={jobStatus}
                success={(next) => `Estimate ${next.number} is a draft again.`}
                onDone={afterAction}
              />
            ) : null}
            {jobActionAllowed(shape, 'log_stage') ? (
              <button type="button" onClick={() => setDialog('stage')}>
                Log stage
              </button>
            ) : null}
            {jobActionAllowed(shape, 'add_reading') ? (
              <button type="button" onClick={() => setDialog('reading')}>
                Add reading
              </button>
            ) : null}
            {jobActionAllowed(shape, 'finish') ? (
              <PlainAction
                label="Mark finished"
                path={`/api/jobs/${jobId}/finish`}
                status={jobStatus}
                success={(next) => `Job ${next.number} marked finished.`}
                onDone={afterAction}
              />
            ) : null}
            {jobActionAllowed(shape, 'issue_invoice') ? (
              <IssueInvoiceButton jobId={jobId} status={jobStatus} onDone={afterAction} />
            ) : null}
          </div>

          {invoice === null ? null : (
            <div className="invoice-block">
              <h3>Invoice</h3>
              <p className="mono">{invoice.number}</p>
              <p>{invoiceStatusLabel(invoice)}</p>
              <p>
                <span className="label">Outstanding</span>{' '}
                <span className="mono">{outstandingLine(invoice)}</span>
              </p>
            </div>
          )}
        </section>
      </div>

      {dialog === 'estimate' ? (
        <EstimateDialog
          status={jobStatus}
          job={job}
          onClose={() => setDialog('none')}
          onSaved={(next) => {
            setDialog('none');
            afterAction(next);
          }}
        />
      ) : null}
      {dialog === 'stage' ? (
        <LogStageDialog
          jobId={jobId}
          job={job}
          status={jobStatus}
          onClose={() => setDialog('none')}
          onSaved={(next) => {
            setDialog('none');
            afterAction(next);
          }}
          fallbackFocus={() => ledgerHeading.current}
        />
      ) : null}
      {dialog === 'reading' ? (
        <AddReadingDialog
          jobId={jobId}
          job={job}
          status={jobStatus}
          onClose={() => setDialog('none')}
          onSaved={() => {
            setDialog('none');
            void load();
          }}
          fallbackFocus={() => ledgerHeading.current}
        />
      ) : null}
      <StatusRegion name="Job updates" status={jobStatus} />
      <StatusRegion name="Upload updates" status={uploadStatus} />
      <StatusRegion name="Invoice updates" status={invoiceStatus} />
      <span className="visually-hidden">{FILM_UNIT_LABEL[units.film]}</span>
    </div>
  );
}

function SendButton({
  job,
  status,
  onDone,
}: {
  job: Job;
  status: StatusHandle;
  onDone(job: Job): void;
}): ReactNode {
  const submit = useSubmit<{ job: Job }>({
    status,
    pendingText: 'Saving...',
    onOk: (body) => {
      status.success(`Estimate ${body.job.number} sent to ${body.job.owner.name}.`);
      onDone(body.job);
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      if (code === 'estimate_changed') {
        status.error(
          `Estimate ${job.number} was changed by someone else. Your edits are kept; reload to see the latest.`,
        );
      } else if (code === 'invalid_transition') {
        status.error(MOVED_ON);
      } else {
        status.error('That could not be saved.');
      }
    },
  });
  return (
    <button
      type="button"
      disabled={submit.busy}
      onClick={() => {
        void submit.run(() =>
          api<{ job: Job }>(`/api/jobs/${job.id}/send`, { body: {}, ifMatch: job.version }),
        );
      }}
    >
      Send to owner
    </button>
  );
}

function PlainAction({
  label,
  path,
  status,
  success,
  onDone,
}: {
  label: string;
  path: string;
  status: StatusHandle;
  success(job: Job): string;
  onDone(job: Job): void;
}): ReactNode {
  const submit = useSubmit<{ job: Job }>({
    status,
    pendingText: 'Saving...',
    onOk: (body) => {
      status.success(success(body.job));
      onDone(body.job);
    },
    onError: (outcome) => {
      status.error(errorCode(outcome) === 'invalid_transition' ? MOVED_ON : 'That could not be saved.');
    },
  });
  return (
    <button
      type="button"
      disabled={submit.busy}
      onClick={() => {
        void submit.run(() => api<{ job: Job }>(path, { body: {} }));
      }}
    >
      {label}
    </button>
  );
}

function IssueInvoiceButton({
  jobId,
  status,
  onDone,
}: {
  jobId: string;
  status: StatusHandle;
  onDone(job: Job): void;
}): ReactNode {
  const submit = useSubmit<{ invoice: Invoice; job: Job }>({
    status,
    pendingText: 'Issuing invoice...',
    idempotent: true,
    noAnswerText: NO_ANSWER.issueInvoice,
    onOk: (body) => {
      status.success(`Invoice ${body.invoice.number} issued for CHF ${body.invoice.total}.`);
      onDone(body.job);
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      if (code === 'invalid_transition') status.error(MOVED_ON);
      else if (code === 'billing_unavailable') {
        status.error(
          'Billing is unreachable. The invoice was not issued; try again when the notice clears.',
        );
      } else if (code === 'idempotency_conflict') status.error(IDEMPOTENCY_CONFLICT);
      else status.error('That could not be saved.');
    },
  });
  return (
    <button
      type="button"
      disabled={submit.busy}
      onClick={() => {
        void submit.run((key) =>
          api<{ invoice: Invoice; job: Job }>(`/api/jobs/${jobId}/invoice`, {
            body: {},
            idempotencyKey: key,
          }),
        );
      }}
    >
      Issue invoice
    </button>
  );
}

function LogStageDialog({
  jobId,
  job,
  status,
  onClose,
  onSaved,
  fallbackFocus,
}: {
  jobId: string;
  job: Job;
  status: StatusHandle;
  onClose: () => void;
  onSaved(job: Job): void;
  fallbackFocus: () => HTMLElement | null;
}): ReactNode {
  const { units } = useSession();
  const logged = new Set(job.stages.map((stage) => stage.name));
  const firstFree = STAGE_NAMES.find((name) => !logged.has(name)) ?? STAGE_NAMES[0];
  const [name, setName] = useState<StageName>(firstFree);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = useSubmit<{ job: Job }>({
    status,
    pendingText: 'Saving stage...',
    onOk: (body) => {
      const count = Object.values(values).filter((value) => value.trim() !== '').length;
      status.success(`${name} logged with ${String(count)} readings.`);
      onSaved(body.job);
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      if (code === 'stage_already_logged') {
        status.error(`${name} is already logged for this job.`);
      } else if (code === 'stage_out_of_order') {
        status.error(`${name} can't be logged after a later stage.`);
      } else if (code === 'invalid_transition') {
        status.error(MOVED_ON);
      } else if (outcome.kind === 'error' && outcome.status === 422) {
        setErrors(fieldErrors(outcome.body));
        status.error('Check the form and try again.');
      } else {
        status.error('That could not be saved.');
      }
    },
  });

  const summary: FieldError[] = Object.entries(errors).map(([field, message]) => ({
    field,
    message,
    inputId: `stage-${field.replace(/[[\].]/g, '-')}`,
  }));

  return (
    <Dialog name="Log stage" onClose={onClose} fallbackFocus={fallbackFocus}>
      <ErrorSummary errors={summary} />
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          const readings = PANELS.filter(
            (panel) => (values[panel.id] ?? '').trim() !== '',
          ).map((panel) => ({
            panel: panel.id,
            value: (values[panel.id] ?? '').trim(),
            unit: units.film,
          }));
          void submit.run(() =>
            api<{ job: Job }>(`/api/jobs/${jobId}/stages`, { body: { name, readings } }),
          );
        }}
      >
        <label htmlFor="stage-name">Stage</label>
        <select
          id="stage-name"
          value={name}
          onChange={(event) => setName(event.target.value as StageName)}
        >
          {STAGE_NAMES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <FieldMessage id="stage-name-error" message={errors.name} />
        <FieldMessage id="stage-readings-error" message={errors.readings} />
        {PANELS.map((panel) => (
          <div className="field" key={panel.id}>
            <label htmlFor={`stage-reading-${panel.id}`}>
              {`${panel.name} reading`}
            </label>
            <input
              id={`stage-reading-${panel.id}`}
              value={values[panel.id] ?? ''}
              onChange={(event) => setValues({ ...values, [panel.id]: event.target.value })}
            />
          </div>
        ))}
        <button type="submit" className="primary" disabled={submit.busy}>
          Save stage
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Dialog>
  );
}

function AddReadingDialog({
  jobId,
  job,
  status,
  onClose,
  onSaved,
  fallbackFocus,
}: {
  jobId: string;
  job: Job;
  status: StatusHandle;
  onClose: () => void;
  onSaved(): void;
  fallbackFocus: () => HTMLElement | null;
}): ReactNode {
  const { units } = useSession();
  const [stageId, setStageId] = useState(job.stages[job.stages.length - 1]?.id ?? '');
  const [panel, setPanel] = useState<PanelId>(PANELS[0]?.id ?? 'bonnet');
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = useSubmit<{
    reading: { film_um: number; panel: PanelId };
  }>({
    status,
    pendingText: 'Saving reading...',
    onOk: (body) => {
      status.success(
        `Reading saved: ${panelName(body.reading.panel)} ${filmReading(body.reading.film_um, units.film)}.`,
      );
      onSaved();
    },
    onError: (outcome) => {
      if (errorCode(outcome) === 'invalid_transition') {
        status.error(MOVED_ON);
      } else if (outcome.kind === 'error' && outcome.status === 422) {
        setErrors(fieldErrors(outcome.body));
        status.error('Check the form and try again.');
      } else {
        status.error('That could not be saved.');
      }
    },
  });

  return (
    <Dialog name="Add reading" onClose={onClose} fallbackFocus={fallbackFocus}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          void submit.run(() =>
            api(`/api/jobs/${jobId}/stages/${stageId}/readings`, {
              body: { panel, value, unit: units.film },
            }),
          );
        }}
      >
        <label htmlFor="reading-stage">Logged stage</label>
        <select
          id="reading-stage"
          value={stageId}
          onChange={(event) => setStageId(event.target.value)}
        >
          {job.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
        <label htmlFor="reading-panel">Panel</label>
        <select
          id="reading-panel"
          value={panel}
          onChange={(event) => setPanel(event.target.value as PanelId)}
        >
          {PANELS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <label htmlFor="reading-value">Reading</label>
        <input
          id="reading-value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <FieldMessage id="reading-value-error" message={errors.value} />
        <button type="submit" className="primary" disabled={submit.busy}>
          Save reading
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Dialog>
  );
}

function StagePhotoUpload({
  jobId,
  carId,
  carName,
  status,
  onStored,
}: {
  jobId: string;
  carId: string;
  carName: string;
  status: StatusHandle;
  onStored(): Promise<void>;
}): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const send = async (): Promise<void> => {
    if (file === null) return;
    const form = new FormData();
    form.append('kind', 'stage');
    form.append('job_id', jobId);
    form.append('file', file);
    setProgress(0);
    status.pending(`Uploading ${file.name}...`);
    const outcome = await upload<{ photo: Photo }>(`/api/cars/${carId}/photos`, form, (fraction) =>
      setProgress(Math.min(95, Math.round(fraction * 95))),
    ).promise;
    if (outcome.kind === 'ok') {
      setProgress(100);
      await onStored();
      setProgress(null);
      status.success(`Photo attached to ${carName}.`);
      return;
    }
    setProgress(null);
    if (outcome.kind === 'no-answer') {
      status.error(UPLOAD_CUT_OFF);
      return;
    }
    if (outcome.status === 413) status.error(UPLOAD_TOO_LARGE);
    else if (errorCode(outcome) === 'storage_unavailable') status.error(STORAGE_DOWN_UPLOAD);
    else status.error('That file could not be stored.');
  };

  return (
    <div className="stack">
      <label htmlFor="stage-photo">Stage photo</label>
      <input
        id="stage-photo"
        type="file"
        accept="image/jpeg,image/png"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button type="button" onClick={() => void send()}>
        Upload stage photo
      </button>
      {progress === null ? null : (
        <progress aria-label="Upload progress" max={100} value={progress} className="upload-progress">
          {progress}
        </progress>
      )}
    </div>
  );
}
