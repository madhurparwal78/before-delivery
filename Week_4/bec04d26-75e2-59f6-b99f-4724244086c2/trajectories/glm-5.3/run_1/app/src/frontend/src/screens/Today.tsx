import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { MeJson, ReturnsEnvelope, ReturnJson } from '../../../shared/types';
import { TopBar } from '../components/TopBar';
import { Tile, EmptyTile } from '../components/Tile';
import { nextStepLabel, dateLine } from '../lib/design';
import { useLiveEvents } from '../lib/live';
import type { Session } from '../lib/session';
import { navigateTo } from '../lib/router';

interface Props {
  me: MeJson;
  service: { mailUp: boolean; pdfUp: boolean };
}

export function Today({ me, service }: Props): React.ReactNode {
  const [envelope, setEnvelope] = useState<ReturnsEnvelope | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const session: Session = { me, signOut: async () => {} };

  const load = async () => {
    const next = await api.returns('');
    setEnvelope(next);
    setSelectedId((current) => current ?? next.returns[0]?.id ?? null);
  };

  useEffect(() => {
    void load();
  }, []);

  // The App carries every live announcement; Today only refreshes its data.
  useLiveEvents(() => {
    void load();
  });

  if (envelope === null) {
    return (
      <>
        <TopBar session={session} route={{ path: '/today', navigate: () => {} }} />
        <main className="page">Loading</main>
      </>
    );
  }

  const weekReturns = envelope.returns.filter((r) => inThisWeek(r, me.now));
  const selected = weekReturns.find((r) => r.id === selectedId) ?? weekReturns[0] ?? null;
  const stateCodes = [...new Set(envelope.returns.map((r) => r.state))].sort();

  return (
    <>
      <TopBar session={session} route={{ path: '/today', navigate: () => {} }} />
      {service.mailUp && service.pdfUp ? null : (
        <div role="region" aria-label="Service notice" className="service-notice">
          {!service.mailUp ? <p className="banner">Reminders are waiting: mail can&#39;t be reached right now.</p> : null}
          {!service.pdfUp ? <p className="banner">Packets are waiting: the PDF service can&#39;t be reached right now.</p> : null}
        </div>
      )}
      <main className="page today-page">
        <div className="hero">
          <div className="hero-left">
            <h1 className="wordmark wordmark-hero">Duefield</h1>
            <p className="hero-sentence">Every return, due in its own state&#39;s time.</p>
          </div>
          <div className="hero-middle">
            {selected === null ? (
              <EmptyTile sentence="No returns due this week." />
            ) : (
              <>
                <Tile ret={selected} stateCodes={stateCodes} size="large" />
                <p className="hero-due" data-next-deadline>
                  Due {dateLine(selected.due_date)}, 11:59 pm {selected.zone_label}
                </p>
                <a
                  className="button button-primary hero-action"
                  href={`/returns/${selected.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigateTo(`/returns/${selected.id}`);
                  }}
                >
                  {nextStepLabel(selected.status)}
                </a>
              </>
            )}
          </div>
          <div className="hero-right">
            <ul aria-label="This week" className="week-list">
              {weekReturns.map((ret, index) => (
                <li key={ret.id} style={{ fontSize: `${Math.max(0.72, 1 - index * 0.09)}rem`, opacity: Math.max(0.35, 1 - index * 0.2) }}>
                  <button
                    type="button"
                    className={`week-item ${selected?.id === ret.id ? 'week-item-selected' : ''}`}
                    onClick={() => setSelectedId(ret.id)}
                  >
                    {ret.client.name} · {ret.state_name} {ret.period_label}
                  </button>
                </li>
              ))}
              {weekReturns.length === 0 ? <li className="week-item-empty">No returns due this week.</li> : null}
            </ul>
          </div>
        </div>
        <div className="counts">
          <p role="status" aria-label="Overdue count">{envelope.counts.overdue} overdue</p>
          <p role="status" aria-label="Awaiting approval count">{envelope.counts.awaiting_approval} awaiting approval</p>
        </div>
      </main>
    </>
  );
}

function inThisWeek(ret: ReturnJson, nowISO: string): boolean {
  const now = new Date(nowISO);
  const parts = ret.due_line.match(/Due (\w+ \w+ \d+)/);
  if (parts === null) return false;
  void now;
  // The server sends the due date; compare it with Central's current week.
  const centralNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const due = new Date(ret.due_at);
  const centralDue = new Date(due.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const monday = new Date(centralNow);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  return centralDue >= monday && centralDue < sunday;
}

