import { useEffect, useState } from "preact/hooks";
import { EVENT_TYPES, type CataloguePlayer, type Club, type CurrentGameweek, type EventType, type MatchEvent, type PriceRunResult } from "../../shared/api.ts";
import { request, type Result } from "../api.ts";
import { useAnnouncer } from "../announce.ts";
import { Modal } from "../components/Dialog.tsx";
import { EVENT_LABEL, isoToLeagueInput, leagueInputToIso, leagueToday, millions, POSITION_WORD, signed, statusLine } from "../format.ts";
import { useLive } from "../live.ts";
import { useApp } from "../store.ts";

// The operator console: Fixtures, Match events, Gameweek and Prices (brief: Screens / Operator console).

const FIXTURES = [1, 2, 3, 4, 5];
const sentence = (label: string) => `${label[0]!.toUpperCase()}${label.slice(1)}`;

function fieldMessages(result: Result<unknown>): string {
  return result.ok ? "" : Object.values(result.error.fields ?? {}).join(" ") || result.error.message;
}

export function OperatorPage() {
  const { gameweek } = useApp();
  const [updates, announce] = useAnnouncer();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [players, setPlayers] = useState<CataloguePlayer[]>([]);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [homes, setHomes] = useState<string[]>(FIXTURES.map(() => ""));
  const [aways, setAways] = useState<string[]>(FIXTURES.map(() => ""));
  const [kickoffs, setKickoffs] = useState<string[]>(FIXTURES.map(() => ""));
  const [fixtureErrors, setFixtureErrors] = useState<string | null>(null);
  const [prefilledFor, setPrefilledFor] = useState<number | null>(null);

  const [fixtureId, setFixtureId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [eventType, setEventType] = useState<EventType>("goal");
  const [value, setValue] = useState("");
  const [eventError, setEventError] = useState<string | null>(null);

  const [closing, setClosing] = useState(false);

  const [runDate, setRunDate] = useState(leagueToday());
  const [movePlayer, setMovePlayer] = useState("");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [moves, setMoves] = useState<{ player_id: string; delta_tenths: 1 | -1 }[]>([]);
  const [priceError, setPriceError] = useState<string | null>(null);

  const number = gameweek?.number ?? 1;
  const clubName = (code: string) => clubs.find((club) => club.code === code)?.name ?? code;
  const playerName = (id: string) => players.find((player) => player.id === id)?.name ?? id;

  const loadEvents = async (n: number) => {
    const result = await request<{ events: MatchEvent[] }>("GET", `/api/operator/gameweeks/${n}/events`);
    if (result.ok) setEvents(result.data.events);
  };
  const loadPlayers = async () => {
    const result = await request<{ players: CataloguePlayer[] }>("GET", "/api/players?sort=name_asc");
    if (result.ok) setPlayers(result.data.players);
  };
  useEffect(() => {
    void request<{ clubs: Club[] }>("GET", "/api/clubs").then((result) => result.ok && setClubs(result.data.clubs));
    void loadPlayers();
  }, []);
  useEffect(() => {
    void loadEvents(number);
  }, [number]);
  useEffect(() => {
    if (!gameweek || prefilledFor === gameweek.number) return;
    setPrefilledFor(gameweek.number);
    const sorted = [...gameweek.fixtures].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
    setHomes(FIXTURES.map((_, i) => sorted[i]?.home ?? ""));
    setAways(FIXTURES.map((_, i) => sorted[i]?.away ?? ""));
    setKickoffs(FIXTURES.map((_, i) => (sorted[i] ? isoToLeagueInput(sorted[i]!.kickoff) : "")));
    setFixtureId(sorted[0]?.id ?? "");
  }, [gameweek]);
  useLive((message) => {
    if (message.t === "event" || message.t === "gameweek") void loadEvents(number);
    if (message.t === "prices") void loadPlayers();
  });

  const publish = async (event: Event) => {
    event.preventDefault();
    const fixtures = FIXTURES.map((_, i) => ({ home: homes[i]!, away: aways[i]!, kickoff: leagueInputToIso(kickoffs[i]!) }));
    const bad = fixtures.findIndex((fixture) => fixture.kickoff === null);
    if (bad >= 0) {
      const message = `Write kickoff ${bad + 1} as year-month-day hour:minute, for example 2031-11-08 15:00.`;
      setFixtureErrors(message);
      announce(message, true);
      return;
    }
    setBusy("publish");
    const result = await request<CurrentGameweek>("PUT", `/api/operator/gameweeks/${number}/fixtures`, { fixtures });
    setBusy(null);
    if (result.ok) {
      setFixtureErrors(null);
      announce(`Fixtures published. Deadline ${result.data.deadline_local ?? ""}.`);
    } else if (result.status === 409) {
      announce(`Gameweek ${number} is not open.`, true);
    } else {
      const message = fieldMessages(result);
      setFixtureErrors(message);
      announce(message, true);
    }
  };

  const fixture = gameweek?.fixtures.find((item) => item.id === fixtureId) ?? null;
  const fixturePlayers = fixture ? players.filter((player) => player.club === fixture.home || player.club === fixture.away) : [];
  const needsValue = eventType === "minutes" || eventType === "bonus";

  // A re-sent event keeps its event id, so a dropped connection never counts it twice.
  const record = async (event: Event) => {
    event.preventDefault();
    const body: Record<string, unknown> = { event_id: crypto.randomUUID(), fixture_id: fixtureId, player_id: playerId, type: eventType };
    if (needsValue) body.value = Number(value);
    setBusy("record");
    let result: Result<MatchEvent> | null = null;
    for (let attempt = 0; attempt < 4 && !result; attempt += 1) {
      try {
        result = await request<MatchEvent>("POST", "/api/operator/events", body);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    setBusy(null);
    if (!result) {
      announce("The connection dropped. Record the event again; it keeps its id and counts once.", true);
    } else if (result.ok) {
      setEventError(null);
      announce(result.replayed ? "Already recorded, not counted again." : "Event recorded.");
      await loadEvents(number);
    } else if (result.error.error === "event_id_conflict") {
      announce("That event id was already used for a different event.", true);
    } else if (result.error.error === "gameweek_not_live") {
      announce(`Gameweek ${number} is not live.`, true);
    } else {
      const message = fieldMessages(result);
      setEventError(message);
      announce(message, true);
    }
  };

  const voidEvent = async (eventId: string) => {
    setBusy(`void-${eventId}`);
    const result = await request<MatchEvent>("POST", `/api/operator/events/${eventId}/void`);
    setBusy(null);
    if (result.ok) announce("Event voided.");
    else announce(result.status === 409 ? `Gameweek ${number} is not live.` : result.error.message, true);
    await loadEvents(number);
  };

  const step = async (kind: "start" | "close") => {
    setBusy(kind);
    const result = await request("POST", `/api/operator/gameweeks/${number}/${kind}`);
    setBusy(null);
    if (result.ok) announce(kind === "start" ? `Gameweek ${number} is live.` : `Gameweek ${number} closed. Final scores are in.`);
    else announce(`Gameweek ${number} cannot do that now.`, true);
  };

  const addMove = () => {
    if (!movePlayer) {
      setPriceError("Choose a player to move.");
      return;
    }
    setPriceError(null);
    setMoves([...moves.filter((move) => move.player_id !== movePlayer), { player_id: movePlayer, delta_tenths: direction }]);
  };

  const runPrices = async (event: Event) => {
    event.preventDefault();
    setBusy("prices");
    const result = await request<PriceRunResult>("POST", "/api/operator/price-runs", { run_date: runDate, moves });
    setBusy(null);
    if (result.ok) {
      setPriceError(null);
      setMoves([]);
      announce(`Price change applied: ${result.data.applied.length} moved, ${result.data.skipped.length} held at the cap.`);
      void loadPlayers();
    } else if (result.error.error === "run_date_used") {
      announce(`A price change already ran for ${runDate}.`, true);
    } else if (result.error.error === "prices_frozen") {
      announce("Prices are frozen until the gameweek closes.", true);
    } else {
      const message = fieldMessages(result);
      setPriceError(message);
      announce(message, true);
    }
  };

  if (clubs.length === 0 || players.length === 0) {
    return (
      <main class="wide">
        <p class="loading board-loading">Loading the console…</p>
      </main>
    );
  }
  return (
    <main class="wide">
      <div class="page-head">
        <h1>Operator console</h1>
      </div>
      <p class={`updates result-strip${updates.error ? " is-error" : ""}`} role="status" aria-label="Operator updates">
        {updates.text}
      </p>
      <div class="console">
        <form class="section panel" onSubmit={publish} noValidate aria-labelledby="fixtures-title">
          <h2 id="fixtures-title">Fixtures</h2>
          <p class="hint">Gameweek {number}. Kickoffs in league time; the deadline is set 90 minutes before the first.</p>
          <div class="fixture-grid">
            {FIXTURES.map((n, i) => (
              <>
                <div class="field" key={`home-${n}`}>
                  <label for={`home-${n}`}>Home team {n}</label>
                  <select id={`home-${n}`} class="input" value={homes[i]} onChange={(e) => setHomes(homes.map((v, j) => (j === i ? e.currentTarget.value : v)))}>
                    <option value="">Choose</option>
                    {clubs.map((club) => (
                      <option value={club.code}>{club.name}</option>
                    ))}
                  </select>
                </div>
                <div class="field" key={`away-${n}`}>
                  <label for={`away-${n}`}>Away team {n}</label>
                  <select id={`away-${n}`} class="input" value={aways[i]} onChange={(e) => setAways(aways.map((v, j) => (j === i ? e.currentTarget.value : v)))}>
                    <option value="">Choose</option>
                    {clubs.map((club) => (
                      <option value={club.code}>{club.name}</option>
                    ))}
                  </select>
                </div>
                <div class="field" key={`kick-${n}`}>
                  <label for={`kickoff-${n}`}>Kickoff {n}</label>
                  <input
                    id={`kickoff-${n}`}
                    class="input mono"
                    placeholder="2031-11-08 15:00"
                    value={kickoffs[i]}
                    onInput={(e) => setKickoffs(kickoffs.map((v, j) => (j === i ? e.currentTarget.value : v)))}
                    aria-describedby={fixtureErrors ? "fixtures-error" : undefined}
                  />
                </div>
              </>
            ))}
          </div>
          {fixtureErrors && (
            <p class="field-error" id="fixtures-error">
              {fixtureErrors}
            </p>
          )}
          <button type="submit" class="btn btn-primary" disabled={busy === "publish"}>
            {busy === "publish" ? "Publishing…" : "Publish fixtures"}
          </button>
        </form>

        <div class="wide">
          <form class="section panel" onSubmit={record} noValidate aria-labelledby="events-title">
            <h2 id="events-title">Match events</h2>
            <div class="field">
              <label for="event-fixture">Fixture</label>
              <select id="event-fixture" class="input" value={fixtureId} onChange={(e) => setFixtureId(e.currentTarget.value)}>
                <option value="">Choose a fixture</option>
                {(gameweek?.fixtures ?? []).map((item) => (
                  <option value={item.id}>
                    {clubName(item.home)} v {clubName(item.away)}
                  </option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="event-player">Player</label>
              <select id="event-player" class="input" value={playerId} onChange={(e) => setPlayerId(e.currentTarget.value)}>
                <option value="">Choose a player</option>
                {fixturePlayers.map((player) => (
                  <option value={player.id}>
                    {player.name} · {player.club} · {POSITION_WORD[player.position]}
                  </option>
                ))}
              </select>
            </div>
            <div class="form-row">
              <div class="field">
                <label for="event-type">Event</label>
                <select id="event-type" class="input" value={eventType} onChange={(e) => setEventType(e.currentTarget.value as EventType)}>
                  {EVENT_TYPES.map((type) => (
                    <option value={type}>{sentence(EVENT_LABEL[type])}</option>
                  ))}
                </select>
              </div>
              <div class="field">
                <label for="event-value">Value</label>
                <input
                  id="event-value"
                  class="input mono"
                  type="number"
                  min={eventType === "minutes" ? 1 : 1}
                  max={eventType === "minutes" ? 120 : 3}
                  disabled={!needsValue}
                  value={needsValue ? value : ""}
                  onInput={(e) => setValue(e.currentTarget.value)}
                  aria-describedby="event-value-hint"
                />
                <p class="hint" id="event-value-hint">
                  {eventType === "minutes" ? "Minutes so far, 1 to 120." : eventType === "bonus" ? "Bonus points, 1 to 3." : "Only for minutes and bonus."}
                </p>
              </div>
            </div>
            {eventError && <p class="field-error">{eventError}</p>}
            <button type="submit" class="btn btn-primary" disabled={busy === "record"}>
              {busy === "record" ? "Recording…" : "Record event"}
            </button>
            <span class="label">Event log</span>
            <ul class="event-log" aria-label="Event log">
              {events.length === 0 && <li>No events in gameweek {number} yet.</li>}
              {[...events].reverse().map((item) => (
                <li key={item.event_id} class={item.voided ? "voided" : ""}>
                  <span class="what">
                    {playerName(item.player_id)} · {EVENT_LABEL[item.type]}
                    {item.value !== null ? ` ${item.value}` : ""} · <span class="mono">{signed(item.points_delta)} pts</span>
                    {item.voided ? " · voided" : ""}
                  </span>
                  {!item.voided && gameweek?.status === "live" && item.gameweek === number && (
                    <button type="button" class="btn btn-danger" disabled={busy === `void-${item.event_id}`} onClick={() => void voidEvent(item.event_id)}>
                      {busy === `void-${item.event_id}` ? "Voiding…" : "Void"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </form>

          <section class="section panel" aria-labelledby="gameweek-title">
            <h2 id="gameweek-title">Gameweek</h2>
            <p class="mono">{gameweek ? statusLine(gameweek.number, gameweek.status, gameweek.deadline_local) : ""}</p>
            <div class="form-row button-row">
              <button type="button" class="btn" disabled={busy === "start"} onClick={() => void step("start")}>
                {busy === "start" ? "Starting…" : "Start gameweek"}
              </button>
              <button type="button" class="btn btn-danger" disabled={busy === "close"} onClick={() => setClosing(true)}>
                {busy === "close" ? "Closing…" : "Close gameweek"}
              </button>
            </div>
          </section>

          <form class="section panel" onSubmit={runPrices} noValidate aria-labelledby="prices-title">
            <h2 id="prices-title">Prices</h2>
            <div class="form-row">
              <div class="field">
                <label for="run-date">Run date</label>
                <input id="run-date" class="input mono" value={runDate} onInput={(e) => setRunDate(e.currentTarget.value)} placeholder="2031-11-08" />
              </div>
              <div class="field">
                <label for="move-player">Move player</label>
                <select id="move-player" class="input" value={movePlayer} onChange={(e) => setMovePlayer(e.currentTarget.value)}>
                  <option value="">Choose a player</option>
                  {players.map((player) => (
                    <option value={player.id}>
                      {player.name} · {player.club} · {millions(player.price_tenths)}m
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="segmented" role="radiogroup" aria-label="Direction">
                <label>
                  <input type="radio" name="direction" checked={direction === 1} onChange={() => setDirection(1)} />
                  Rise
                </label>
                <label>
                  <input type="radio" name="direction" checked={direction === -1} onChange={() => setDirection(-1)} />
                  Fall
                </label>
              </div>
              <button type="button" class="btn" onClick={addMove}>
                Add move
              </button>
            </div>
            <ul class="moves" aria-label="Moves">
              {moves.length === 0 && <li>No moves added yet.</li>}
              {moves.map((move) => (
                <li key={move.player_id}>
                  <span>
                    {playerName(move.player_id)} · {move.delta_tenths > 0 ? "rise 0.1m" : "fall 0.1m"}
                  </span>
                  <button type="button" class="btn btn-quiet" onClick={() => setMoves(moves.filter((m) => m.player_id !== move.player_id))}>
                    Remove<span class="sr-only"> {playerName(move.player_id)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {priceError && <p class="field-error">{priceError}</p>}
            <button type="submit" class="btn btn-primary" disabled={busy === "prices"}>
              {busy === "prices" ? "Running…" : "Run price change"}
            </button>
          </form>
        </div>
      </div>
      {closing && (
        <Modal title="Close gameweek" onClose={() => setClosing(false)}>
          {(close) => (
            <>
              <p>Closing gameweek {number} applies auto-subs and the captain fallback, fixes every score and opens the next gameweek. It cannot be undone.</p>
              <div class="dialog-actions">
                <button type="button" class="btn" onClick={close}>
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn btn-danger"
                  onClick={() => {
                    setClosing(false);
                    void step("close");
                  }}
                >
                  Close gameweek
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </main>
  );
}
