import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, newOperationId, reasonOf } from '../lib/api.js';
import { Link, useRouter } from '../lib/router.js';
import { displayWallClock } from '../lib/format.js';
import { Modal } from '../components/Common.js';
import { BillingBanner, UpgradeDialog } from '../components/Billing.js';
import {
  STATUS_LABELS,
  TEMPLATE_LABELS,
  type Billing,
  type FacilitatorWorkshop,
  type TemplateCode,
} from '../../shared/protocol.js';

export function Workshops(): JSX.Element {
  const { navigate } = useRouter();
  const [workshops, setWorkshops] = useState<readonly FacilitatorWorkshop[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [limit, setLimit] = useState<ApiError | null>(null);
  const [status, setStatus] = useState('');
  const newWorkshopButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, bill] = await Promise.all([
        api<{ workshops: FacilitatorWorkshop[] }>('GET', '/api/workshops'),
        api<Billing>('GET', '/api/billing'),
      ]);
      setWorkshops(list.workshops);
      setBilling(bill);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) navigate('/signin');
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = workshops.filter((workshop) => workshop.status !== 'archived');
  const archived = workshops.filter((workshop) => workshop.status === 'archived');

  return (
    <main className="column workshops">
      {billing && <BillingBanner billing={billing} onChanged={setBilling} />}
      <div className="spread">
        <h1>Your workshops</h1>
        <div className="row">
          <Link to="/billing">Plan and billing</Link>
          <Link to="/activity">Activity log</Link>
          <button
            type="button"
            onClick={async () => {
              await api('DELETE', '/api/session');
              navigate('/signin');
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="row">
        <button type="button" className="primary" ref={newWorkshopButton} onClick={() => setDialogOpen(true)}>
          New workshop
        </button>
      </div>

      <div role="status" aria-live="polite" className="status-line">
        {status}
      </div>

      <h2 className="section-heading">Workshops</h2>
      <ul className="rule-list" aria-label="Workshops">
        {active.map((workshop) => (
          <WorkshopRow key={workshop.id} workshop={workshop} />
        ))}
      </ul>

      <h2 className="section-heading">Archived</h2>
      <ul className="rule-list" aria-label="Archived">
        {archived.map((workshop) => (
          <WorkshopRow key={workshop.id} workshop={workshop} />
        ))}
      </ul>

      {dialogOpen && (
        <NewWorkshopDialog
          onClose={() => setDialogOpen(false)}
          onPlanLimit={(error) => {
            setDialogOpen(false);
            setLimit(error);
          }}
          onCreated={(workshop, template) => {
            setStatus(`Workshop created from the ${TEMPLATE_LABELS[template]} template`);
            navigate(`/w/${workshop.id}`);
          }}
        />
      )}
      {limit && <UpgradeDialog error={limit} onClose={() => setLimit(null)} />}
    </main>
  );
}

function WorkshopRow({ workshop }: { workshop: FacilitatorWorkshop }): JSX.Element {
  return (
    <li className="workshop-row">
      <Link to={`/w/${workshop.id}`}>{workshop.title}</Link>
      <span className="workshop-meta">
        <span className="status-label">{STATUS_LABELS[workshop.status]}</span>
        <span className="mono muted">{displayWallClock(workshop.scheduledStart)}</span>
      </span>
    </li>
  );
}

const TEMPLATES: readonly TemplateCode[] = ['retrospective', 'discovery', 'strategy', 'blank'];

function NewWorkshopDialog({
  onClose,
  onCreated,
  onPlanLimit,
}: {
  onClose: () => void;
  onCreated: (workshop: FacilitatorWorkshop, template: TemplateCode) => void;
  onPlanLimit: (error: ApiError) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<TemplateCode>('retrospective');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [sponsorEmail, setSponsorEmail] = useState('');
  const [fee, setFee] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setFields({});
    // An empty fee sends no "fee" field at all, so the workshop's fee is "0.00".
    const body: Record<string, unknown> = {
      title,
      template,
      scheduledStart: startsAt,
      scheduledEnd: endsAt,
      sponsorEmail,
    };
    if (fee.trim() !== '') body.fee = fee.trim();
    try {
      const created = await api<{ workshop: FacilitatorWorkshop }>('POST', '/api/workshops', body);
      onCreated(created.workshop, template);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'plan_limit') {
        onPlanLimit(error);
        return;
      }
      if (error instanceof ApiError && error.fields) setFields(error.fields);
      else setFields({ title: reasonOf(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal title="New workshop" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="workshop-title">Title</label>
          <input id="workshop-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          {fields.title && <p className="field-error">{fields.title}</p>}
        </div>

        <fieldset className="field" role="radiogroup" aria-label="Template">
          <span className="field-label">Template</span>
          {TEMPLATES.map((code) => (
            <label key={code} className="row option-row">
              <input
                type="radio"
                name="template"
                value={code}
                checked={template === code}
                onChange={() => setTemplate(code)}
              />
              <span>{TEMPLATE_LABELS[code]}</span>
            </label>
          ))}
          {fields.template && <p className="field-error">{fields.template}</p>}
        </fieldset>

        <div className="field">
          <label htmlFor="workshop-starts">Starts</label>
          <input
            id="workshop-starts"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
          {fields.scheduledStart && <p className="field-error">{fields.scheduledStart}</p>}
        </div>

        <div className="field">
          <label htmlFor="workshop-ends">Ends</label>
          <input
            id="workshop-ends"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
          {fields.scheduledEnd && <p className="field-error">{fields.scheduledEnd}</p>}
        </div>

        <div className="field">
          <label htmlFor="workshop-sponsor">Sponsor email</label>
          <input
            id="workshop-sponsor"
            type="text"
            value={sponsorEmail}
            onChange={(e) => setSponsorEmail(e.target.value)}
          />
          {fields.sponsorEmail && <p className="field-error">{fields.sponsorEmail}</p>}
        </div>

        <div className="field">
          <label htmlFor="workshop-fee">Client fee (EUR)</label>
          <input id="workshop-fee" type="text" value={fee} onChange={(e) => setFee(e.target.value)} />
          {fields.fee && <p className="field-error">{fields.fee}</p>}
        </div>

        <div className="row">
          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create workshop'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
