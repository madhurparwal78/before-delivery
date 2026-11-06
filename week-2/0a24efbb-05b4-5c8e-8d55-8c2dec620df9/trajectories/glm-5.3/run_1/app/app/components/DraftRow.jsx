import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { announce } from './LiveRegions.jsx';
import { TYPE_CODES, TYPE_LABELS } from '../lib/queue-query.jsx';

const REASON_MIN = 20;

export function DraftRow({ cancelHref = '/requests' }) {
  const navigate = useNavigate();
  const [day, setDay] = useState('');
  const [type, setType] = useState('');
  const [claimedIn, setClaimedIn] = useState('');
  const [claimedOut, setClaimedOut] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(null);
  const idemKeyRef = useRef(null);
  if (!idemKeyRef.current) {
    idemKeyRef.current = crypto.randomUUID();
  }

  const needsIn = type === 'missed_in' || type === 'offsite' || type === 'whole_day' || type === 'night_shift';
  const needsOut = type === 'missed_out' || type === 'offsite' || type === 'whole_day' || type === 'night_shift';

  function cellError(field) {
    if (field === 'day' && !day) return 'This is required.';
    if (field === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'This is required.';
    if (field === 'type' && !type) return 'This is required.';
    if (field === 'claimed_in' && needsIn && !claimedIn) return 'This is required.';
    if (field === 'claimed_out' && needsOut && !claimedOut) return 'This is required.';
    if (field === 'reason') {
      if (!reason) return 'This is required.';
      if (graphemes(reason) < REASON_MIN) return `This needs at least ${REASON_MIN} characters.`;
    }
    return null;
  }

  function validate() {
    const fields = ['day', 'type', 'claimed_in', 'claimed_out', 'reason'];
    const out = {};
    for (const f of fields) {
      const e = cellError(f);
      if (e) out[f] = e;
    }
    setErrors(out);
    const count = Object.keys(out).length;
    if (count > 0) {
      announce('assertive', `Fields needing attention: ${count}.`);
      const first = fields.find((f) => out[f]);
      document.getElementById(`draft-${first}`)?.focus();
      return false;
    }
    return true;
  }

  async function send() {
    if (!validate() || busy) return;
    setBusy(true);
    setEnded(null);
    try {
      const body = {
        day,
        correction_type: type,
        claimed_in: needsIn || claimedIn ? claimedIn || null : null,
        claimed_out: needsOut || claimedOut ? claimedOut || null : null,
        reason,
      };
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idemKeyRef.current,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.error === 'Your session has ended. Sign in again.') {
        setEnded(data.error);
        return;
      }
      if (!res.ok) {
        setErrors((prev) => ({ ...prev, [data.field || 'reason']: data.error }));
        announce('assertive', data.error || 'The desk could not reach the server. Try again.');
        if (data.field) document.getElementById(`draft-${data.field}`)?.focus();
        return;
      }
      announce('assertive', `Correction for ${data.day} is waiting for a decision.`);
      navigate(`/requests/${data.id}`, { replace: true });
    } catch {
      announce('assertive', 'The desk could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr className="draft-row">
        <td><StateCell /></td>
        <td className="cell-person">—</td>
        <td>
          <label htmlFor="draft-day" className="visually-hidden">Day to correct</label>
          <input id="draft-day" type="date" value={day} onChange={(e) => { setDay(e.target.value); setErrors((p) => ({ ...p, day: null })); }} aria-invalid={!!errors.day} aria-describedby={errors.day ? 'draft-day-error' : undefined} />
          {errors.day && <span className="cell-error" id="draft-day-error">{errors.day}</span>}
        </td>
        <td>
          <label htmlFor="draft-type" className="visually-hidden">Correction type</label>
          <select id="draft-type" value={type} onChange={(e) => { setType(e.target.value); setErrors((p) => ({ ...p, type: null })); }} aria-invalid={!!errors.type} aria-describedby={errors.type ? 'draft-type-error' : undefined}>
            <option value="">Correction type</option>
            {TYPE_CODES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          {errors.type && <span className="cell-error" id="draft-type-error">{errors.type}</span>}
        </td>
        <td>
          <div className="draft-times">
            <label htmlFor="draft-in" className="visually-hidden">Claimed sign in</label>
            <input id="draft-in" type="time" value={claimedIn} onChange={(e) => { setClaimedIn(e.target.value); setErrors((p) => ({ ...p, claimed_in: null })); }} aria-invalid={!!errors.claimed_in} aria-describedby={errors.claimed_in ? 'draft-in-error' : undefined} />
            <label htmlFor="draft-out" className="visually-hidden">Claimed sign out</label>
            <input id="draft-out" type="time" value={claimedOut} onChange={(e) => { setClaimedOut(e.target.value); setErrors((p) => ({ ...p, claimed_out: null })); }} aria-invalid={!!errors.claimed_out} aria-describedby={errors.claimed_out || (type === 'night_shift') ? 'draft-out-error' : undefined} />
            {errors.claimed_in && <span className="cell-error" id="draft-in-error">{errors.claimed_in}</span>}
            {errors.claimed_out && <span className="cell-error" id="draft-out-error">{errors.claimed_out}</span>}
            {type === 'night_shift' && !errors.claimed_out && (
              <span className="help" id="draft-out-error">Ends the following day.</span>
            )}
          </div>
        </td>
        <td className="cell-times">—</td>
        <td className="cell-raised">—</td>
        <td>
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {busy ? 'Sending for approval' : 'Send for approval'}
          </button>
          <a href={cancelHref} className="draft-discard">Discard draft</a>
        </td>
      </tr>
      <tr className="draft-reason-row">
        <td colSpan={8}>
          <label htmlFor="draft-reason" className="draft-reason-label">Reason</label>
          <textarea
            id="draft-reason"
            value={reason}
            rows={2}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby="draft-reason-help"
            aria-invalid={!!errors.reason}
          />
          <p className="help" id="draft-reason-help">
            Twenty to 280 characters. Each emoji counts as one. Your manager reads this.
          </p>
          {errors.reason && <span className="cell-error" role="alert">{errors.reason}</span>}
          {busy && <span className="status-line" role="status">Sending for approval</span>}
          {ended && (
            <span className="ended-line" role="alert">
              {ended} <a href={`/login?next=${encodeURIComponent('/requests/new')}`}>Sign in again</a>
            </span>
          )}
        </td>
      </tr>
    </>
  );
}

function StateCell() {
  return <span className="chip chip-draft">Draft</span>;
}

function graphemes(text) {
  const trimmed = text.replace(/^[\s\u0085]+|[\s\u0085]+$/g, '');
  if (typeof Intl.Segmenter === 'function') {
    let n = 0;
    for (const _ of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(trimmed)) n++;
    return n;
  }
  return [...trimmed].length;
}
