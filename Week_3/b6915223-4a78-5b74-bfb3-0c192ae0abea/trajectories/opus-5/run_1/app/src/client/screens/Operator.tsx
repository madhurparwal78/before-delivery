import { useCallback, useEffect, useRef, useState } from 'react';
import type { Club, EventType, MatchEvent, PlayerRow } from '../../shared/types.ts';
import { EVENT_LABELS } from '../../shared/copy.ts';
import { formatLeagueDeadline, leagueLocalToIso } from '../../shared/leagueTime.ts';
import { api, RequestFailed } from '../api.ts';
import { LiveRegion, useAnnounce } from '../live.tsx';
import { useApp } from '../state.tsx';
import { Dialog } from '../components/Dialog.tsx';

const EVENT_TYPES: EventType[] = [
  'minutes',
  'goal',
  'assist',
  'clean_sheet',
  'yellow_card',
  'red_card',
  'own_goal',
  'bonus',
];

const NEEDS_VALUE = new Set<EventType>(['minutes', 'bonus']);

const freshEventId = (): string =>
  `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const Operator = () => {
  const { gameweek } = useApp();
  const announce = useAnnounce();

  const [clubs, setClubs] = useState<Club[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [fixtureRows, setFixtureRows] = useState(
    Array.from({ length: 5 }, () => ({ home: '', away: '', kickoff: '' })),
  );
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [eventForm, setEventForm] = useState({
    fixture_id: '',
    player_id: '',
    type: 'goal' as EventType,
    value: 1,
  });
  const [runDate, setRunDate] = useState('');
  const [movePlayer, setMovePlayer] = useState('');
  const [moveDirection, setMoveDirection] = useState<'rise' | 'fall'>('rise');
  const [moves, setMoves] = useState<{ player_id: string; delta_tenths: number }[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const eventId = useRef(freshEventId());
  const closeButton = useRef<HTMLButtonElement | null>(null);

  const gameweekNumber = gameweek?.number ?? 1;

  const refreshEvents = useCallback(async () => {
    setEvents((await api.events(gameweekNumber)).events);
  }, [gameweekNumber]);

  useEffect(() => {
    void api.clubs().then((result) => setClubs(result.clubs));
    void api.players('?sort=name_asc').then((result) => setPlayers(result.players));
  }, []);

  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);

  const fail = (error: unknown): void => {
    if (!(error instanceof RequestFailed)) throw error;
    if (error.body.fields !== undefined) setFieldErrors(error.body.fields);
    announce('Operator updates', error.body.message);
  };

  const publish = async (): Promise<void> => {
    setPending('fixtures');
    setFieldErrors({});
    const fixtures = fixtureRows.map((row) => ({
      home: row.home,
      away: row.away,
      kickoff: leagueLocalToIso(row.kickoff) ?? row.kickoff,
    }));
    try {
      const result = await api.publishFixtures(gameweekNumber, fixtures);
      announce(
        'Operator updates',
        `Fixtures published. Deadline ${
          result.deadline === null ? '' : formatLeagueDeadline(result.deadline)
        }.`,
      );
    } catch (error) {
      if (error instanceof RequestFailed && error.body.error === 'gameweek_not_open') {
        announce('Operator updates', `Gameweek ${gameweekNumber} is not open.`);
        setPending(null);
        return;
      }
      fail(error);
    } finally {
      setPending(null);
    }
  };

  const record = async (): Promise<void> => {
    setPending('event');
    setFieldErrors({});
    try {
      await api.recordEvent({
        event_id: eventId.current,
        fixture_id: eventForm.fixture_id,
        player_id: eventForm.player_id,
        type: eventForm.type,
        ...(NEEDS_VALUE.has(eventForm.type) ? { value: eventForm.value } : {}),
      });
      eventId.current = freshEventId();
      await refreshEvents();
      announce('Operator updates', 'Event recorded.');
    } catch (error) {
      if (error instanceof RequestFailed && error.body.error === 'event_id_conflict') {
        announce('Operator updates', 'That event id was already used for a different event.');
      } else if (error instanceof RequestFailed && error.body.error === 'gameweek_not_live') {
        announce('Operator updates', `Gameweek ${gameweekNumber} is not live.`);
      } else {
        fail(error);
      }
    } finally {
      setPending(null);
    }
  };

  const voidEvent = async (id: string): Promise<void> => {
    setPending(`void-${id}`);
    try {
      await api.voidEvent(id);
      await refreshEvents();
      announce('Operator updates', 'Event voided.');
    } catch (error) {
      if (error instanceof RequestFailed && error.body.error === 'gameweek_not_live') {
        announce('Operator updates', `Gameweek ${gameweekNumber} is not live.`);
      } else fail(error);
    } finally {
      setPending(null);
    }
  };

  const start = async (): Promise<void> => {
    setPending('start');
    try {
      await api.startGameweek(gameweekNumber);
      announce('Operator updates', `Gameweek ${gameweekNumber} is live.`);
    } catch (error) {
      if (error instanceof RequestFailed) {
        announce('Operator updates', `Gameweek ${gameweekNumber} cannot do that now.`);
      } else throw error;
    } finally {
      setPending(null);
    }
  };

  const close = async (): Promise<void> => {
    setCloseOpen(false);
    setPending('close');
    try {
      await api.closeGameweek(gameweekNumber);
      announce('Operator updates', `Gameweek ${gameweekNumber} closed. Final scores are in.`);
    } catch (error) {
      if (error instanceof RequestFailed) {
        announce('Operator updates', `Gameweek ${gameweekNumber} cannot do that now.`);
      } else throw error;
    } finally {
      setPending(null);
    }
  };

  const runPrices = async (): Promise<void> => {
    setPending('prices');
    setFieldErrors({});
    try {
      const result = await api.priceRun(runDate, moves);
      setMoves([]);
      announce(
        'Operator updates',
        `Price change applied: ${result.applied.length} moved, ${result.skipped.length} held at the cap.`,
      );
    } catch (error) {
      if (error instanceof RequestFailed && error.body.error === 'run_date_used') {
        announce('Operator updates', `A price change already ran for ${runDate}.`);
      } else if (error instanceof RequestFailed && error.body.error === 'prices_frozen') {
        announce('Operator updates', 'Prices are frozen until the gameweek closes.');
      } else fail(error);
    } finally {
      setPending(null);
    }
  };

  const fixtures = gameweek?.fixtures ?? [];

  return (
    <section className="page operator">
      <h1>Operator console</h1>

      <section className="panel">
        <h2>Fixtures</h2>
        {fixtureRows.map((row, index) => (
          <div key={index} className="fixture-row">
            <label htmlFor={`home-${index + 1}`}>{`Home team ${index + 1}`}</label>
            <select
              id={`home-${index + 1}`}
              value={row.home}
              onChange={(event) =>
                setFixtureRows((current) =>
                  current.map((entry, position) =>
                    position === index ? { ...entry, home: event.target.value } : entry,
                  ),
                )
              }
            >
              <option value="">Choose a club</option>
              {clubs.map((club) => (
                <option key={club.code} value={club.code}>
                  {club.name}
                </option>
              ))}
            </select>

            <label htmlFor={`away-${index + 1}`}>{`Away team ${index + 1}`}</label>
            <select
              id={`away-${index + 1}`}
              value={row.away}
              onChange={(event) =>
                setFixtureRows((current) =>
                  current.map((entry, position) =>
                    position === index ? { ...entry, away: event.target.value } : entry,
                  ),
                )
              }
            >
              <option value="">Choose a club</option>
              {clubs.map((club) => (
                <option key={club.code} value={club.code}>
                  {club.name}
                </option>
              ))}
            </select>

            <label htmlFor={`kickoff-${index + 1}`}>{`Kickoff ${index + 1}`}</label>
            <input
              id={`kickoff-${index + 1}`}
              className="mono"
              placeholder="2026-11-08 15:00"
              value={row.kickoff}
              aria-describedby={
                fieldErrors[`kickoff_${index + 1}`] === undefined
                  ? undefined
                  : `kickoff-${index + 1}-error`
              }
              onChange={(event) =>
                setFixtureRows((current) =>
                  current.map((entry, position) =>
                    position === index ? { ...entry, kickoff: event.target.value } : entry,
                  ),
                )
              }
            />
            {fieldErrors[`kickoff_${index + 1}`] !== undefined && (
              <p id={`kickoff-${index + 1}-error`} className="field-error">
                {fieldErrors[`kickoff_${index + 1}`]}
              </p>
            )}
          </div>
        ))}
        {fieldErrors.fixtures !== undefined && <p className="field-error">{fieldErrors.fixtures}</p>}
        <button type="button" disabled={pending === 'fixtures'} onClick={() => void publish()}>
          {pending === 'fixtures' ? 'Publishing…' : 'Publish fixtures'}
        </button>
      </section>

      <section className="panel">
        <h2>Match events</h2>
        <label htmlFor="event-fixture">Fixture</label>
        <select
          id="event-fixture"
          value={eventForm.fixture_id}
          onChange={(event) =>
            setEventForm((current) => ({ ...current, fixture_id: event.target.value }))
          }
        >
          <option value="">Choose a fixture</option>
          {fixtures.map((fixture) => (
            <option key={fixture.id} value={fixture.id}>
              {`${fixture.home} v ${fixture.away}`}
            </option>
          ))}
        </select>

        <label htmlFor="event-player">Player</label>
        <select
          id="event-player"
          value={eventForm.player_id}
          onChange={(event) =>
            setEventForm((current) => ({ ...current, player_id: event.target.value }))
          }
        >
          <option value="">Choose a player</option>
          {players.map((player) => (
            <option key={player.id} value={player.id}>
              {`${player.name} (${player.club})`}
            </option>
          ))}
        </select>

        <label htmlFor="event-type">Event</label>
        <select
          id="event-type"
          value={eventForm.type}
          onChange={(event) =>
            setEventForm((current) => ({ ...current, type: event.target.value as EventType }))
          }
        >
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_LABELS[type]}
            </option>
          ))}
        </select>

        <label htmlFor="event-value">Value</label>
        <input
          id="event-value"
          type="number"
          className="mono"
          value={eventForm.value}
          onChange={(event) =>
            setEventForm((current) => ({ ...current, value: Number(event.target.value) }))
          }
        />

        <button type="button" disabled={pending === 'event'} onClick={() => void record()}>
          {pending === 'event' ? 'Recording…' : 'Record event'}
        </button>

        <ul aria-label="Event log" className="event-log">
          {events.map((event) => (
            <li key={event.event_id} className={event.voided ? 'event voided' : 'event'}>
              <span>{`${event.player_id} · ${EVENT_LABELS[event.type]}`}</span>
              <span className="mono">{`${event.points_delta >= 0 ? '+' : ''}${event.points_delta} pts`}</span>
              {event.voided ? (
                <span>Voided</span>
              ) : (
                <button
                  type="button"
                  disabled={pending === `void-${event.event_id}`}
                  onClick={() => void voidEvent(event.event_id)}
                >
                  {pending === `void-${event.event_id}` ? 'Voiding…' : 'Void'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Gameweek</h2>
        <button type="button" disabled={pending === 'start'} onClick={() => void start()}>
          {pending === 'start' ? 'Starting…' : 'Start gameweek'}
        </button>
        <button
          type="button"
          ref={closeButton}
          disabled={pending === 'close'}
          onClick={() => setCloseOpen(true)}
        >
          {pending === 'close' ? 'Closing…' : 'Close gameweek'}
        </button>
      </section>

      <section className="panel">
        <h2>Prices</h2>
        <label htmlFor="run-date">Run date</label>
        <input
          id="run-date"
          className="mono"
          placeholder="2026-11-05"
          value={runDate}
          aria-describedby={fieldErrors.run_date === undefined ? undefined : 'run-date-error'}
          onChange={(event) => setRunDate(event.target.value)}
        />
        {fieldErrors.run_date !== undefined && (
          <p id="run-date-error" className="field-error">
            {fieldErrors.run_date}
          </p>
        )}

        <label htmlFor="move-player">Move player</label>
        <select
          id="move-player"
          value={movePlayer}
          onChange={(event) => setMovePlayer(event.target.value)}
        >
          <option value="">Choose a player</option>
          {players.map((player) => (
            <option key={player.id} value={player.id}>
              {`${player.name} (${player.club})`}
            </option>
          ))}
        </select>

        <div role="radiogroup" aria-label="Direction" className="view-toggle">
          <button
            type="button"
            role="radio"
            aria-checked={moveDirection === 'rise'}
            onClick={() => setMoveDirection('rise')}
          >
            Rise
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={moveDirection === 'fall'}
            onClick={() => setMoveDirection('fall')}
          >
            Fall
          </button>
        </div>

        <button
          type="button"
          onClick={() =>
            setMoves((current) =>
              movePlayer === '' || current.some((move) => move.player_id === movePlayer)
                ? current
                : [
                    ...current,
                    { player_id: movePlayer, delta_tenths: moveDirection === 'rise' ? 1 : -1 },
                  ],
            )
          }
        >
          Add move
        </button>

        <ul aria-label="Moves" className="move-list">
          {moves.map((move) => (
            <li key={move.player_id} className="mono">
              {`${move.player_id} ${move.delta_tenths > 0 ? 'rise' : 'fall'}`}
            </li>
          ))}
        </ul>
        {fieldErrors.moves !== undefined && <p className="field-error">{fieldErrors.moves}</p>}

        <button type="button" disabled={pending === 'prices'} onClick={() => void runPrices()}>
          {pending === 'prices' ? 'Running…' : 'Run price change'}
        </button>
      </section>

      {closeOpen && (
        <Dialog
          title="Close gameweek"
          onClose={() => setCloseOpen(false)}
          returnFocusTo={closeButton.current}
        >
          <p>{`Closing gameweek ${gameweekNumber} applies auto-subs and fixes final scores.`}</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => void close()}>
              Close gameweek
            </button>
            <button type="button" onClick={() => setCloseOpen(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}

      <LiveRegion name="Operator updates" />
    </section>
  );
};
