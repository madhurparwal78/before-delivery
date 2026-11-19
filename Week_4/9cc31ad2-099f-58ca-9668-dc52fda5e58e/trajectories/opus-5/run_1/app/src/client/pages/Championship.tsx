import { useEffect, useRef, useState } from 'react';
import { LAYOUTS, LEAGUE_NAMES, carSpec } from '../../shared/catalogue.js';
import { Dialog } from '../components/Dialog.js';
import { Page } from '../components/Page.js';
import { TrackOutline, TulipGlyphs } from '../components/TrackOutline.js';
import { copy, leaguePointsCopy, loanerCopy } from '../copy.js';
import { takeEventFocus } from '../focus-intent.js';
import { raceAddress } from '../race-address.js';
import { navigate } from '../router.js';
import { refreshChampionship, useChampionship } from '../store.js';
import type { ChampionshipEvent } from '../types.js';

export function Championship() {
  const championship = useChampionship();
  const [loaner, setLoaner] = useState<ChampionshipEvent | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const completed = useRef<Set<string> | null>(null);
  const loanerButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void refreshChampionship();
  }, []);

  useEffect(() => {
    const wanted = takeEventFocus();
    if (wanted !== null && championship !== null) {
      document.getElementById(`enter-${wanted}`)?.focus();
    }
  }, [championship !== null]);

  // Announces a league completing while the page is open.
  useEffect(() => {
    if (championship === null) return;
    const seen = completed.current;
    if (seen !== null) {
      for (const league of championship.leagues) {
        if (league.status === 'complete' && !seen.has(league.leagueId)) {
          setAnnouncement(
            league.leagueId === 'rookie'
              ? copy.rookieCompleteAnnouncement
              : copy.clubCompleteAnnouncement,
          );
        }
      }
    }
    completed.current = new Set(
      championship.leagues
        .filter((league) => league.status === 'complete')
        .map((league) => league.leagueId),
    );
  }, [championship]);

  useEffect(() => {
    if (loaner !== null) loanerButton.current?.focus();
  }, [loaner]);

  const enter = (event: ChampionshipEvent) => {
    if (!event.eligible && event.loanerCarId !== null) {
      setLoaner(event);
      return;
    }
    navigate(raceAddress({ layoutId: event.layoutId, mode: event.mode, eventId: event.eventId }));
  };

  return (
    <Page gutter={['Rookie', 'Club']}>
      <h1>Championship</h1>
      <div className="league-grid">
        {(championship?.leagues ?? []).map((league) => (
          <section
            className="cell"
            role="region"
            aria-label={LEAGUE_NAMES[league.leagueId]}
            key={league.leagueId}
          >
            <h2>{LEAGUE_NAMES[league.leagueId]}</h2>
            <p className="figure">
              {league.status === 'locked'
                ? copy.clubLocked
                : league.status === 'complete'
                  ? `${copy.leagueComplete} · ${leaguePointsCopy(league.points)}`
                  : leaguePointsCopy(league.points)}
            </p>
            {league.leagueId === 'club' && championship?.trophy && <p>{copy.trophy}</p>}
            {league.events.map((event) => (
              <div className="map-card" key={event.eventId}>
                <TulipGlyphs />
                <h3>{event.name}</h3>
                <p>
                  {LAYOUTS[event.layoutId].name} · class {event.class} ·{' '}
                  <span className="mono">{event.points} pts</span>
                </p>
                <TrackOutline layoutId={event.layoutId} height={80} />
                <button
                  type="button"
                  className="primary"
                  id={`enter-${event.eventId}`}
                  disabled={league.status === 'locked'}
                  onClick={() => enter(event)}
                >
                  Enter {event.name}
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="cell" role="status" aria-label="Championship updates">
        {announcement}
      </div>
      {loaner !== null && (
        <Dialog
          label="Loaner car"
          onEscape={() => {
            setLoaner(null);
            document.getElementById(`enter-${loaner.eventId}`)?.focus();
          }}
        >
          <h2>Loaner car</h2>
          <p>{loanerCopy(loaner.class, carSpec(loaner.loanerCarId ?? 'kestrel-hatch').name)}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              ref={loanerButton}
              onClick={() =>
                navigate(
                  raceAddress({
                    layoutId: loaner.layoutId,
                    mode: loaner.mode,
                    eventId: loaner.eventId,
                  }),
                )
              }
            >
              Race the loaner
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setLoaner(null);
                document.getElementById(`enter-${loaner.eventId}`)?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </Page>
  );
}
