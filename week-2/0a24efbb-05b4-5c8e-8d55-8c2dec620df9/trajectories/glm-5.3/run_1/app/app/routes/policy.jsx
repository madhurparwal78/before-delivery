import { useRef, useState } from 'react';
import { useLoaderData, useRevalidator, useRouteError, data } from 'react-router';
import { announce } from '../components/LiveRegions.jsx';
import { RouteErrorBoundary } from '../components/ErrorPages.jsx';
import { DownloadIcon } from '../components/icons.jsx';
import { TYPE_LABELS, TYPE_CODES } from '../lib/queue-query.jsx';

export const handle = { crumb: 'Correction policy' };

export function ErrorBoundary() {
  return <RouteErrorBoundary error={useRouteError()} signedIn />;
}

export async function loader({ request }) {
  const { viewerFromRequest, loadPolicyFull } = await import('../lib/data.server.js');
  const viewer = await viewerFromRequest(request);
  if (!viewer) throw data(null, { status: 401 });
  if (viewer.role !== 'admin') throw data(null, { status: 403 });
  const full = await loadPolicyFull();
  return { viewer, ...full, policyVersion: full.policy.version };
}

export default function Policy() {
  const { policy, history, trail } = useLoaderData();
  const revalidator = useRevalidator();
  const [form, setForm] = useState({
    monthly_cap: policy.monthly_cap,
    lookback_days: policy.lookback_days,
    enabled_types: policy.enabled_types,
    require_note_on_approve: policy.require_note_on_approve,
  });
  const [changingVersion, setChangingVersion] = useState(policy.version);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState(null);
  const [callout, setCallout] = useState(null);
  const saveRef = useRef(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setFieldError(null);
    announce('polite', 'Saving policy');
    try {
      const res = await fetch('/api/policy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'if-match': `"${changingVersion}"` },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setChangingVersion(body.version);
        setCallout(null);
        announce('assertive', `Policy version ${body.version} is now in force.`);
        await revalidator.revalidate();
        saveRef.current?.focus();
        return;
      }
      if (res.status === 412) {
        setCallout(`Version ${body.version} was saved by ${body.created_by}. Your changes are still in the form.`);
        // find who saved the version now in force
        const fresh = await fetch('/api/policy').then((r) => r.json());
        setChangingVersion(fresh.version);
        announce('assertive', body.error);
        await revalidator.revalidate();
        saveRef.current?.focus();
        return;
      }
      if (body.field) setFieldError(body.field);
      announce('assertive', body.error || 'The desk could not reach the server. Try again.');
      if (body.field === 'enabled_types') {
        document.getElementById('type-missed_in')?.focus();
      } else if (body.field) {
        document.getElementById(`policy-${body.field}`)?.focus();
      }
    } catch {
      announce('assertive', 'The desk could not reach the server. Try again.');
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="policy-page">
      <h1>Correction policy</h1>
      {callout && <p className="callout" role="note">{callout}</p>}
      <form className="policy-form" onSubmit={(e) => { e.preventDefault(); setConfirmOpen(true); }}>
        <fieldset>
          <legend>Corrections allowed per person each month, and the lookback</legend>
          <div className="field">
            <label htmlFor="policy-monthly_cap">Corrections allowed per person each month</label>
            <input
              id="policy-monthly_cap"
              type="number"
              min={0}
              max={10}
              value={form.monthly_cap}
              onChange={(e) => setForm({ ...form, monthly_cap: e.target.value })}
              aria-invalid={fieldError === 'monthly_cap'}
              aria-describedby={fieldError === 'monthly_cap' ? 'policy-monthly_cap-error' : undefined}
            />
            {fieldError === 'monthly_cap' && <p className="help error" id="policy-monthly_cap-error" role="alert">monthly_cap must be a whole number from 0 to 10.</p>}
          </div>
          <div className="field">
            <label htmlFor="policy-lookback_days">How many days back a correction may reach</label>
            <input
              id="policy-lookback_days"
              type="number"
              min={1}
              max={90}
              value={form.lookback_days}
              onChange={(e) => setForm({ ...form, lookback_days: e.target.value })}
              aria-invalid={fieldError === 'lookback_days'}
              aria-describedby={fieldError === 'lookback_days' ? 'policy-lookback_days-error' : undefined}
            />
            {fieldError === 'lookback_days' && <p className="help error" id="policy-lookback_days-error" role="alert">lookback_days must be a whole number from 1 to 90.</p>}
          </div>
        </fieldset>
        <fieldset aria-invalid={fieldError === 'enabled_types'} aria-describedby={fieldError === 'enabled_types' ? 'policy-enabled_types-error' : undefined}>
          <legend>Corrections people may raise</legend>
          {TYPE_CODES.map((t) => (
            <label key={t} className="check-line">
              <input
                id={`type-${t}`}
                type="checkbox"
                checked={form.enabled_types.includes(t)}
                aria-invalid={fieldError === 'enabled_types'}
                onChange={(e) => {
                  setForm({
                    ...form,
                    enabled_types: e.target.checked
                      ? TYPE_CODES.filter((c) => form.enabled_types.includes(c) || c === t)
                      : form.enabled_types.filter((c) => c !== t),
                  });
                }}
              />
              {TYPE_LABELS[t]}
            </label>
          ))}
          {fieldError === 'enabled_types' && <p className="help error" id="policy-enabled_types-error" role="alert">At least one correction type must stay available.</p>}
        </fieldset>
        <div className="field">
          <label className="check-line">
            <input
              id="policy-require_note_on_approve"
              type="checkbox"
              checked={form.require_note_on_approve}
              aria-invalid={fieldError === 'require_note_on_approve'}
              onChange={(e) => setForm({ ...form, require_note_on_approve: e.target.checked })}
            />
            Require a note when approving
          </label>
          {fieldError === 'require_note_on_approve' && <p className="help error" role="alert">require_note_on_approve must be true or false.</p>}
        </div>
        <div className="field">
          <label className="check-line" htmlFor="policy-self_approval">
            <input
              id="policy-self_approval"
              type="checkbox"
              role="switch"
              checked={false}
              disabled
              aria-describedby="policy-self-help"
            />
            Allow managers to approve their own corrections
          </label>
          <p className="help" id="policy-self-help">Not available. Self approval is refused by this product.</p>
        </div>
        <button type="submit" className="primary" ref={saveRef} disabled={busy}>
          Save new version
        </button>
        {busy && <p className="status-line" role="status">Saving policy</p>}
      </form>

      {confirmOpen && (
        <ConfirmDialog
          version={changingVersion + 1}
          onSave={save}
          onClose={() => {
            setConfirmOpen(false);
            saveRef.current?.focus();
          }}
        />
      )}

      <section className="policy-history">
        <h2>Previous versions</h2>
        <table className="history-table">
          <caption className="visually-hidden">Policy version history</caption>
          <thead>
            <tr><th scope="col">Version</th><th scope="col">Cap</th><th scope="col">Lookback</th><th scope="col">Saved by</th><th scope="col">Saved at</th></tr>
          </thead>
          <tbody>
            {history.map((v) => (
              <tr key={v.version}>
                <td>{v.version}</td>
                <td>{v.monthly_cap}</td>
                <td>{v.lookback_days}</td>
                <td>{v.created_by}</td>
                <td>{v.created_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="policy-trail">
        <h2>Whole trail</h2>
        <p><a href="/api/trail.csv" className="trail-download"><DownloadIcon /> Download trail</a></p>
        <ul className="trail-list">
          {trail.map((a) => (
            <li key={a.seq}>
              {a.seq}. {a.actor} {a.verb.replace('_', ' ')} on {a.occurred_at.slice(0, 10)}
              {a.note ? ` — ${a.note}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ConfirmDialog({ version, onSave, onClose }) {
  const dialogRef = useRef(null);
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-heading"
      className="confirm-dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Tab') {
          const focusables = dialogRef.current.querySelectorAll('button');
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <h2 id="confirm-heading">Save this policy?</h2>
      <p>This appends version {version}. Requests already waiting stay waiting.</p>
      <div className="sheet-actions">
        <button type="button" className="secondary" autoFocus onClick={onSave}>Save</button>
        <button type="button" className="secondary" onClick={onClose}>Keep editing</button>
      </div>
    </div>
  );
}
