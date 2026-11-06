import { useEffect, useRef, useState } from 'react';
import { Link, useLoaderData, useLocation, useRevalidator, data } from 'react-router';
import { StateChip } from '../components/StateChip.jsx';
import { announce } from '../components/LiveRegions.jsx';
import { TYPE_LABELS } from '../lib/queue-query.jsx';
import { addDays } from '../../src/domain/time.js';
export async function loader({ request, params }) {
  const { viewerFromRequest, loadDetail } = await import('../lib/data.server.js');
  const viewer = await viewerFromRequest(request);
  if (!viewer) throw data(null, { status: 401 });
  if (!/^[1-9][0-9]*$/.test(params.id) || params.id.length > 19
    || (params.id.length === 19 && params.id > '9223372036854775807')) {
    throw data(null, { status: 404 });
  }
  try {
    const detail = await loadDetail(viewer, Number(params.id));
    return { viewer, detail, crumb: `Correction for ${detail.request.day}` };
  } catch {
    throw data(null, { status: 404 });
  }
}


export default function RequestDetail() {
  const { viewer, detail } = useLoaderData();
  const location = useLocation();
  const revalidator = useRevalidator();
  const [current, setCurrent] = useState(detail);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState(null);
  const [ended, setEnded] = useState(null);
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [current.request.id]);

  useEffect(() => {
    setCurrent(detail);
    setNote('');
    setAlert(null);
  }, [detail]);

  const request = current.request;
  const day = request.day;
  const mayDecide = viewer.role !== 'admin'
    && request.state === 'pending'
    && request.person !== viewer.name;
  const mayWithdraw = request.state === 'pending' && isRaiser(viewer, current);

  async function decide(outcome) {
    if (busy) return;
    setBusy(true);
    announce('polite', 'Saving decision');
    try {
      const res = await fetch(`/api/requests/${request.id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome, note: note || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCurrent((c) => ({ ...c, request: data }));
        announce('assertive', outcome === 'approve'
          ? `Correction approved. The attendance record for ${day} now reads the claimed times.`
          : 'Correction rejected.');
        headingRef.current?.focus();
        await revalidator.revalidate();
        return;
      }
      if (res.status === 409) {
        announce('assertive', data.error);
        const fresh = await fetch(`/api/requests/${request.id}`).then((r) => r.json());
        setCurrent(fresh);
        setAlert(null);
        headingRef.current?.focus();
        await revalidator.revalidate();
        return;
      }
      if (res.status === 401 && data.error === 'Your session has ended. Sign in again.') {
        setEnded(data.error);
        return;
      }
      setAlert(data.error || 'The desk could not reach the server. Try again.');
      announce('assertive', data.error || 'The desk could not reach the server. Try again.');
    } catch {
      setAlert('The desk could not reach the server. Try again.');
      announce('assertive', 'The desk could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (busy) return;
    setBusy(true);
    announce('polite', 'Withdrawing request');
    try {
      const res = await fetch(`/api/requests/${request.id}/cancel`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCurrent((c) => ({ ...c, request: data }));
        announce('assertive', 'Request withdrawn. That day is free to claim again.');
        headingRef.current?.focus();
        await revalidator.revalidate();
        return;
      }
      if (res.status === 409) {
        announce('assertive', data.error);
        const fresh = await fetch(`/api/requests/${request.id}`).then((r) => r.json());
        setCurrent(fresh);
        headingRef.current?.focus();
        await revalidator.revalidate();
        return;
      }
      if (res.status === 401 && data.error === 'Your session has ended. Sign in again.') {
        setEnded(data.error);
        return;
      }
      setAlert(data.error || 'The desk could not reach the server. Try again.');
    } catch {
      setAlert('The desk could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const backHref = `/requests?${location.search ? location.search.slice(1) : ''}`;

  return (
    <section className="detail-pane" aria-labelledby="detail-heading">
      <h1 id="detail-heading" ref={headingRef} tabIndex={-1}>Correction for {day}</h1>
      <p className="detail-state"><StateChip state={request.state} /></p>
      <p className="raised-by">Raised by {request.person}, reporting to {request.manager ?? 'nobody'}</p>
      {viewer.role === 'admin' && current.contact && (
        <div className="contact-block">
          <h2>Contact on file</h2>
          <p>Phone {current.contact.phone}</p>
          <p>{current.contact.private_note}</p>
        </div>
      )}
      <div className="evidence">
        <div className="evidence-block">
          <h2>What the clock recorded</h2>
          <PunchLine label="Sign in" instant={current.evidence.recorded_in} />
          <PunchLine label="Sign out" instant={current.evidence.recorded_out} />
        </div>
        <div className="evidence-block">
          <h2>What is claimed</h2>
          <p>{TYPE_LABELS[request.correction_type]}</p>
          <p>
            {request.claimed_in || 'Not recorded'}
            {request.claimed_in && request.claimed_out && ' – '}
            {request.claimed_out
              ? (request.correction_type === 'night_shift'
                  ? `${request.claimed_out} on ${addDays(day, 1)}`
                  : request.claimed_out)
              : ''}
          </p>
        </div>
        <div className="evidence-block">
          <h2>Leave that day</h2>
          {current.leave ? (
            <p>
              {current.leave.label}, {current.leave.status}
            </p>
          ) : (
            <p>No leave recorded</p>
          )}
        </div>
      </div>
      <div className="reason-block">
        <h2>Reason given</h2>
        <p className="pane-prose">{request.reason}</p>
      </div>
      {mayDecide && (
        <div className="decision-controls">
          <label htmlFor="decision-note">Note</label>
          <textarea
            id="decision-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby="decision-note-help"
          />
          <p className="help" id="decision-note-help">Required when rejecting. At least ten characters.</p>
          {alert && <p className="form-error" role="alert">{alert}</p>}
          {ended && (
            <p className="form-error" role="alert">
              {ended} <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in again</Link>
            </p>
          )}
          <div className="decision-buttons">
            <button type="button" className="primary" onClick={() => decide('approve')} disabled={busy}>
              Approve
            </button>
            <button type="button" className="secondary" onClick={() => decide('reject')} disabled={busy}>
              Reject
            </button>
          </div>
          {busy && <p className="status-line" role="status">Saving decision</p>}
        </div>
      )}
      {mayWithdraw && (
        <div className="decision-controls">
          {alert && <p className="form-error" role="alert">{alert}</p>}
          {ended && (
            <p className="form-error" role="alert">
              {ended} <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in again</Link>
            </p>
          )}
          <button type="button" className="secondary" onClick={withdraw} disabled={busy}>
            Withdraw
          </button>
          {busy && <p className="status-line" role="status">Withdrawing request</p>}
        </div>
      )}
      <div className="trail-block">
        <h2>What happened</h2>
        {current.audit.length === 0 ? (
          <p className="pane-prose">Nothing has been decided yet.</p>
        ) : (
          <ul className="trail-list pane-prose">
            {current.audit.map((a) => (
              <li key={a.seq}>
                {a.actor} {a.verb.replace('_', ' ')} on {a.occurred_at.slice(0, 10)}
                {a.note ? ` — ${a.note}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="detail-back">
        <Link to={backHref} state={{ focusRow: request.id }}>Back to the queue</Link>
      </p>
    </section>
  );
}

function PunchLine({ label, instant }) {
  const time = instant
    ? new Date(instant).toLocaleTimeString('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;
  return <p>{label}: {time ?? 'Not recorded'}</p>;
}

function isRaiser(viewer, detail) {
  return detail.request.work_address === viewer.work_address;
}
