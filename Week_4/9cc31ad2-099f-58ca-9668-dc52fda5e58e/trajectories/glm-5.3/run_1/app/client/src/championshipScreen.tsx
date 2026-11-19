// Championship: both leagues, event map cards, loaner dialog, live updates.
import { useEffect, useRef, useState, type JSX } from 'react';
import { api, type Championship, type ChampionshipEvent } from './api';
import { useApp, usePush } from './appState';
import { Dialog, navigate } from './ui';
import { LAYOUTS, type LayoutId } from '../../shared/domain';
import { fmtTime } from './formats';

export default function ChampionshipScreen(): JSX.Element {
  const { me } = useApp();
  const [champ, setChamp] = useState<Championship | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [loanerEvent, setLoanerEvent] = useState<ChampionshipEvent | null>(null);
  const rookieCompleteRef = useRef<boolean | null>(null);
  const clubCompleteRef = useRef<boolean | null>(null);

  const load = async (): Promise<void> => {
    try {
      setChamp(await api.championship());
    } catch { /* ignore */ }
  };

  useEffect(() => { void load(); }, []);

  usePush((msg) => {
    if (msg.type === 'championship') {
      void load();
    }
  });

  // Announce completions when they flip while the page is open.
  useEffect(() => {
    if (!champ) return;
    const rookie = champ.leagues.find(l => l.leagueId === 'rookie');
    const club = champ.leagues.find(l => l.leagueId === 'club');
    if (rookieCompleteRef.current === false && rookie?.status === 'complete') {
      setAnnouncement('Rookie league complete. Club league and Quarry Switchbacks unlocked.');
    }
    if (clubCompleteRef.current === false && club?.status === 'complete') {
      setAnnouncement('Club league complete. Trophy and 1,000 coins added.');
    }
    rookieCompleteRef.current = rookie?.status === 'complete';
    clubCompleteRef.current = club?.status === 'complete';
  }, [champ]);

  const enter = (ev: ChampionshipEvent): void => {
    if (!ev.eligible && ev.loanerCarId) {
      setLoanerEvent(ev);
      return;
    }
    navigate(`/race?layout=${ev.layoutId}&mode=${ev.mode}&event=${ev.eventId}`, '[data-focus="race-hud"]');
  };

  const raceLoaner = (ev: ChampionshipEvent): void => {
    navigate(`/race?layout=${ev.layoutId}&mode=${ev.mode}&event=${ev.eventId}&loaner=1`.replace('&loaner=1', ''), '[data-focus="race-hud"]');
    // The loaner is requested by the run creation, guided by the event's class.
    setLoanerEvent(null);
  };

  return (
    <main className="page" style={{ paddingTop: 20 }}>
      <h1>Championship</h1>
      <div className="status" role="status" aria-live="polite" aria-label="Championship updates">{announcement}</div>
      {!champ && <p>Loading…</p>}
      {champ && (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {champ.leagues.map(league => (
            <section key={league.leagueId} className="rule-cell" aria-label={league.leagueId === 'rookie' ? 'Rookie league' : 'Club league'}
                     data-region={league.leagueId}>
              <h2>{league.leagueId === 'rookie' ? 'Rookie league' : 'Club league'}</h2>
              <p className="status">
                {league.status === 'complete'
                  ? league.leagueId === 'club' ? 'Club champion trophy' : 'Complete'
                  : league.status === 'locked'
                    ? 'Locked until the Rookie league is complete'
                    : `${league.points} / 50 points`}
              </p>
              <div style={{ display: 'grid', gap: 10 }}>
                {league.events.map(ev => (
                  <div key={ev.eventId} className="rule-cell" data-event={ev.eventId}
                       style={{ background: 'var(--paper)' }}>
                    <MapCard ev={ev} />
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="mono">{ev.points} pts</span>
                      <button
                        className="btn"
                        data-enter
                        disabled={league.status === 'locked'}
                        onClick={() => enter(ev)}
                      >
                        Enter {ev.name}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {loanerEvent && (
        <Dialog title="Loaner car" onClose={() => setLoanerEvent(null)}>
          <h2>Loaner car</h2>
          <p>
            You have no eligible class {loanerEvent.class} car. Race the loaner{' '}
            {loanerEvent.loanerCarId} for half result coins?
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => raceLoaner(loanerEvent)}>Race the loaner</button>
            <button className="btn" onClick={() => setLoanerEvent(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {me === null && <p>Sign in to enter events.</p>}
    </main>
  );
}

/** A map card: the event's name, map, points and track outline with tulip glyphs. */
function MapCard({ ev }: { ev: ChampionshipEvent }): JSX.Element {
  const layout = LAYOUTS[ev.layoutId as LayoutId];
  const w = 220;
  const x = (m: number): number => (m / layout.length) * w;
  return (
    <div style={{ minWidth: 0 }}>
      <strong>{ev.name}</strong>
      <div className="mono">{layout.name}</div>
      <svg viewBox={`-4 -10 ${w + 8} 30`} width="100%" height={30} aria-hidden="true" style={{ display: 'block' }}>
        <line x1={0} y1={6} x2={w} y2={6} stroke="var(--rule)" />
        <line x1={0} y1={6} x2={x(layout.sectors[0])} y2={6} stroke="var(--ink)" strokeWidth={2} />
        <line x1={x(layout.sectors[0])} y1={6} x2={x(layout.sectors[1])} y2={6} stroke="var(--ink)" strokeWidth={2} />
        <line x1={x(layout.sectors[1])} y1={6} x2={w} y2={6} stroke="var(--ink)" strokeWidth={2} />
        {layout.corners.map((c, i) => (
          <g key={i} transform={`translate(${x(c.start) + 3}, 6)`}>
            {/* Tulip glyph: a junction with an arrow, as in a rally route book. */}
            <line x1={-4} y1={-8} x2={0} y2={0} stroke="var(--ink)" strokeWidth={1.4} />
            <line x1={-4} y1={8} x2={0} y2={0} stroke="var(--ink)" strokeWidth={1.4} />
            <line x1={-4} y1={-8} x2={-4} y2={8} stroke="var(--ink)" strokeWidth={1.4} />
            <path d="M0 0 L4 0" stroke="var(--accent)" strokeWidth={1.6} />
          </g>
        ))}
      </svg>
    </div>
  );
}
