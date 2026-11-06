import { useState } from 'react';
import { useLoaderData, useNavigate, useSearchParams, useRouteError, data } from 'react-router';
import { announce } from '../components/LiveRegions.jsx';
import { RouteErrorBoundary } from '../components/ErrorPages.jsx';
import { MonthGrid, MarkLegend } from '../components/MonthGrid.jsx';
import { monthName, addMonths } from '../../src/domain/time.js';

export const handle = { crumb: 'Team calendar' };

export function ErrorBoundary() {
  return <RouteErrorBoundary error={useRouteError()} signedIn />;
}

export async function loader({ request }) {
  const { viewerFromRequest, loadCalendar, loadPolicyVersion } = await import('../lib/data.server.js');
  const viewer = await viewerFromRequest(request);
  if (!viewer) throw data(null, { status: 401 });
  if (viewer.role === 'employee') throw data(null, { status: 403 });
  const url = new URL(request.url);
  let month = url.searchParams.get('month') || '';
  if (!month) {
    const { query } = await import('../../src/db/pg.js');
    const rows = await query('SELECT seeded_on FROM employer WHERE id = 1');
    month = rows[0].seeded_on.toISOString().slice(0, 7);
  }
  const person = url.searchParams.get('person') || '';
  const calendar = await loadCalendar(viewer, month, person);
  return { viewer, ...calendar, policyVersion: await loadPolicyVersion() };
}

export default function Calendar() {
  const { viewer, month, days, people } = useLoaderData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [person, setPerson] = useState(params.get('person') || '');
  const [monthInput, setMonthInput] = useState(month);
  const [sharedLink, setSharedLink] = useState(null);
  const [linkError, setLinkError] = useState(null);
  const [busy, setBusy] = useState(false);

  const narrowed = people.find((p) => p.work_address === person);
  const canShare = !!narrowed && (viewer.role === 'admin' || viewer.role === 'manager');

  function show() {
    const next = new URLSearchParams();
    if (monthInput) next.set('month', monthInput);
    if (person) next.set('person', person);
    setSharedLink(null);
    navigate(`/calendar?${next.toString()}`, { replace: true });
  }

  async function share() {
    if (busy || !narrowed) return;
    setBusy(true);
    setLinkError(null);
    announce('polite', 'Creating shared link');
    try {
      const res = await fetch('/api/share-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ person_id: narrowed.id, month }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLinkError(data.error || 'The desk could not reach the server. Try again.');
        announce('assertive', data.error || 'The desk could not reach the server. Try again.');
        return;
      }
      setSharedLink(data);
      const expires = data.expires_at.replace('T', ' ').slice(0, 16);
      announce('assertive', `Shared link created. It works until ${expires}. Any earlier link for this month no longer works.`);
      requestAnimationFrame(() => {
        const el = document.getElementById('shared-link-field');
        el?.focus();
        el?.select();
      });
    } catch {
      setLinkError('The desk could not reach the server. Try again.');
      announce('assertive', 'The desk could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!sharedLink) return;
    setBusy(true);
    announce('polite', 'Revoking link');
    try {
      const res = await fetch(`/api/share-links/${sharedLink.id}`, { method: 'DELETE' });
      if (res.status === 204) {
        setSharedLink(null);
        announce('assertive', 'Shared link revoked.');
        document.getElementById('share-month')?.focus();
      } else {
        const data = await res.json().catch(() => ({}));
        announce('assertive', data.error || 'The desk could not reach the server. Try again.');
        if (res.status === 409) setSharedLink(null);
      }
    } catch {
      announce('assertive', 'The desk could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="calendar-page">
      <h1>Team calendar</h1>
      <div className="month-steps">
        <a href={`/calendar?month=${addMonths(month, -1)}${person ? `&person=${encodeURIComponent(person)}` : ''}`}>Previous month</a>
        <span className="month-name">{monthName(month)} {month.slice(0, 4)}</span>
        <a href={`/calendar?month=${addMonths(month, 1)}${person ? `&person=${encodeURIComponent(person)}` : ''}`}>Next month</a>
      </div>
      <div className="calendar-narrow">
        <label htmlFor="calendar-person">Person</label>
        <select id="calendar-person" value={person} onChange={(e) => { setPerson(e.target.value); setSharedLink(null); }}>
          <option value="">Everyone in scope</option>
          {people.map((p) => (
            <option key={p.id} value={p.work_address}>{p.name}</option>
          ))}
        </select>
        <label htmlFor="calendar-month" className="visually-hidden">Month</label>
        <input
          id="calendar-month"
          type="text"
          className="calendar-month-input"
          value={monthInput}
          onChange={(e) => { setMonthInput(e.target.value); setSharedLink(null); }}
          aria-label="Month"
        />
        <button type="button" className="primary" onClick={show}>Show</button>
        {canShare && (
          <button type="button" className="secondary" id="share-month" onClick={share} disabled={busy}>
            Share this month
          </button>
        )}
      </div>
      {linkError && <p className="form-error" role="alert">{linkError}</p>}
      {sharedLink && (
        <div className="shared-link-row">
          <label htmlFor="shared-link-field">Shared link</label>
          <input
            id="shared-link-field"
            type="text"
            readOnly
            value={`${window.location?.origin || ''}/share/${sharedLink.token}`}
          />
          <button type="button" className="secondary" onClick={revoke} disabled={busy}>Revoke link</button>
        </div>
      )}
      <MonthGrid month={month} days={days} />
      <MarkLegend />
    </div>
  );
}

