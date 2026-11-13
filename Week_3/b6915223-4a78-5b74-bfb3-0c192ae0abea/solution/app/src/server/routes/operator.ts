import { isEventType, type EventType, type MatchEvent, type PriceRunResult } from "../../shared/api.ts";
import { fingerprint, IDEMPOTENCY_KEY } from "../canonical.ts";
import { type Db, pool, publish, tx } from "../db.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { closeGameweek } from "../close.ts";
import { currentGameweek, describeGameweek, type GameweekRow } from "../gameweeks.ts";
import { json, route } from "../http.ts";
import { noticeText, queueNotice } from "../notices.ts";
import { assertStep, DEADLINE_LEAD_MS } from "../rules/gameweek.ts";
import { appearancePoints, eventPoints } from "../rules/scoring.ts";
import { clubList, playerIndex } from "../views.ts";
import { gameweekParam, objectBody } from "../validate.ts";

// The game operator's console endpoints (brief: Operator).

const KICKOFF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const PRICE_MOVES_PER_GAMEWEEK = 3;

async function gameweekForUpdate(db: Db, number: number): Promise<GameweekRow> {
  const found = await db.query<GameweekRow>("SELECT number, status, deadline, first_kickoff FROM gameweeks WHERE number = $1 FOR UPDATE", [number]);
  return found.rows[0]!;
}

interface EventRow {
  event_id: string;
  gameweek: number;
  fixture_id: string;
  player_id: string;
  type: EventType;
  value: number | null;
  points_delta: number;
  voided: boolean;
  recorded_at: Date;
}

const eventJson = (row: EventRow): MatchEvent => ({ ...row, recorded_at: row.recorded_at.toISOString() });

export const operatorRoutes = [
  route("PUT", "/api/operator/gameweeks/:number/fixtures", "operator", async ({ params, body }) => {
    const number = gameweekParam(params.number);
    return tx(async (db) => {
      const gameweek = await gameweekForUpdate(db, number);
      assertStep(number, gameweek.status, "publish");
      const input = objectBody(body);
      const clubs = new Set((await clubList(db)).map((club) => club.code));
      const fixtures = Array.isArray(input.fixtures) ? (input.fixtures as unknown[]) : [];
      const parsed = fixtures.map((item) => {
        const fixture = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
        const kickoff = typeof fixture.kickoff === "string" && KICKOFF.test(fixture.kickoff) ? new Date(fixture.kickoff) : null;
        return { home: String(fixture.home ?? ""), away: String(fixture.away ?? ""), kickoff: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff : null };
      });
      const named = parsed.flatMap((fixture) => [fixture.home, fixture.away]);
      if (parsed.length !== 5) throw invalid({ fixtures: "Publish exactly 5 fixtures." });
      if (!named.every((code) => clubs.has(code)) || new Set(named).size !== clubs.size) {
        throw invalid({ fixtures: "Every club plays exactly once." });
      }
      if (parsed.some((fixture) => fixture.kickoff === null)) throw invalid({ kickoff: "Each kickoff is an ISO 8601 time with an offset." });
      const firstKickoff = new Date(Math.min(...parsed.map((fixture) => fixture.kickoff!.getTime())));
      const deadline = new Date(firstKickoff.getTime() - DEADLINE_LEAD_MS);
      if (deadline <= new Date()) throw invalid({ fixtures: "The deadline, 90 minutes before the first kickoff, must be in the future." });
      const tag = String(number).padStart(2, "0");
      await db.query("DELETE FROM fixtures WHERE gameweek = $1", [number]);
      for (const fixture of parsed) {
        await db.query(
          "INSERT INTO fixtures (id, gameweek, home, away, kickoff) VALUES ($1, $2, $3, $4, $5)",
          [`gw${tag}-${fixture.home}-${fixture.away}`, number, fixture.home, fixture.away, fixture.kickoff],
        );
      }
      const updated = await db.query<GameweekRow>(
        "UPDATE gameweeks SET deadline = $2, first_kickoff = $3 WHERE number = $1 RETURNING number, status, deadline, first_kickoff",
        [number, deadline, firstKickoff],
      );
      await publish(db, { t: "gameweek" });
      return json(200, await describeGameweek(db, updated.rows[0]!));
    });
  }),

  route("POST", "/api/operator/gameweeks/:number/start", "operator", async ({ params }) => {
    const number = gameweekParam(params.number);
    return tx(async (db) => {
      assertStep(number, (await gameweekForUpdate(db, number)).status, "start");
      await db.query("UPDATE gameweeks SET status = 'live' WHERE number = $1", [number]);
      await publish(db, { t: "gameweek" });
      return json(200, { number, status: "live" });
    });
  }),

  route("POST", "/api/operator/gameweeks/:number/close", "operator", async ({ params }) => {
    const number = gameweekParam(params.number);
    const next = await closeGameweek(number);
    return json(200, { number, status: "closed", next_gameweek: next });
  }),

  route("GET", "/api/operator/gameweeks/:number/events", "operator", async ({ params }) => {
    const number = gameweekParam(params.number);
    const rows = await pool.query<EventRow>(
      "SELECT event_id, gameweek, fixture_id, player_id, type, value, points_delta, voided, recorded_at FROM match_events WHERE gameweek = $1 ORDER BY seq",
      [number],
    );
    return json(200, { events: rows.rows.map(eventJson) });
  }),

  route("POST", "/api/operator/events", "operator", async ({ body }) => {
    const input = objectBody(body);
    const eventId = typeof input.event_id === "string" && IDEMPOTENCY_KEY.test(input.event_id) ? input.event_id : null;
    if (!eventId) throw invalid({ event_id: "event_id is 1 to 64 letters, digits, - or _." });
    const print = fingerprint(input);
    return tx(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('event:' || $1))", [eventId]);
      const earlier = await db.query<{ fingerprint: string; response: string }>(
        "SELECT fingerprint, response FROM match_events WHERE event_id = $1",
        [eventId],
      );
      if (earlier.rows[0]) {
        if (earlier.rows[0].fingerprint !== print) throw conflict("event_id_conflict", "That event id was already used for a different event.");
        return { status: 201, raw: Buffer.from(earlier.rows[0].response), headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" } };
      }
      const live = await db.query<GameweekRow>("SELECT number, status, deadline, first_kickoff FROM gameweeks WHERE status = 'live' FOR SHARE");
      const gameweek = live.rows[0] ?? (await currentGameweek(db));
      assertStep(gameweek.number, gameweek.status, "record");
      const type = input.type;
      const fields: Record<string, string> = {};
      if (!isEventType(type)) fields.type = "Unknown event type.";
      const valueRange = type === "minutes" ? [1, 120] : type === "bonus" ? [1, 3] : null;
      const value = input.value;
      if (valueRange) {
        if (typeof value !== "number" || !Number.isInteger(value) || value < valueRange[0]! || value > valueRange[1]!) {
          fields.value = `value must be a whole number from ${valueRange[0]} to ${valueRange[1]}.`;
        }
      } else if ("value" in input) {
        fields.value = "value is only sent for minutes and bonus.";
      }
      const fixture = await db.query<{ home: string; away: string }>("SELECT home, away FROM fixtures WHERE id = $1 AND gameweek = $2", [
        String(input.fixture_id ?? ""),
        gameweek.number,
      ]);
      const players = await playerIndex(db);
      const player = players.get(String(input.player_id ?? ""));
      if (!fixture.rows[0]) fields.fixture_id = "Unknown fixture for this gameweek.";
      else if (!player || (player.club !== fixture.rows[0].home && player.club !== fixture.rows[0].away)) {
        fields.player_id = "The player's club is not in this fixture.";
      }
      if (Object.keys(fields).length > 0 || !isEventType(type)) throw invalid(fields);
      const scorer = player!;
      const fixtureId = String(input.fixture_id);
      let pointsDelta: number;
      if (type === "minutes") {
        await db.query("SELECT pg_advisory_xact_lock(hashtext('minutes:' || $1 || $2))", [scorer.id, fixtureId]);
        const most = await db.query<{ most: number }>(
          "SELECT COALESCE(MAX(value), 0)::int AS most FROM match_events WHERE player_id = $1 AND fixture_id = $2 AND type = 'minutes' AND NOT voided",
          [scorer.id, fixtureId],
        );
        const before = most.rows[0]!.most;
        pointsDelta = appearancePoints(Math.max(before, value as number)) - appearancePoints(before);
      } else {
        pointsDelta = eventPoints(type, scorer.position, typeof value === "number" ? value : null);
      }
      const event: MatchEvent = {
        event_id: eventId,
        gameweek: gameweek.number,
        fixture_id: fixtureId,
        player_id: scorer.id,
        type,
        value: typeof value === "number" ? value : null,
        points_delta: pointsDelta,
        voided: false,
        recorded_at: new Date().toISOString(),
      };
      await db.query(
        `INSERT INTO match_events (event_id, gameweek, fixture_id, player_id, type, value, points_delta, recorded_at, fingerprint, response)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [eventId, event.gameweek, fixtureId, scorer.id, type, event.value, pointsDelta, event.recorded_at, print, JSON.stringify(event)],
      );
      await publish(db, { t: "event", event_id: eventId, player_id: scorer.id, type, points_delta: pointsDelta, voided: false });
      return json(201, event);
    });
  }),

  route("POST", "/api/operator/events/:id/void", "operator", async ({ params }) =>
    tx(async (db) => {
      const found = await db.query<EventRow>(
        "SELECT event_id, gameweek, fixture_id, player_id, type, value, points_delta, voided, recorded_at FROM match_events WHERE event_id = $1 FOR UPDATE",
        [params.id ?? ""],
      );
      const event = found.rows[0];
      if (!event) throw notFound("No event has that id.");
      const gameweek = await db.query<GameweekRow>("SELECT number, status, deadline, first_kickoff FROM gameweeks WHERE number = $1 FOR SHARE", [
        event.gameweek,
      ]);
      assertStep(event.gameweek, gameweek.rows[0]!.status, "record");
      if (!event.voided) {
        await db.query("UPDATE match_events SET voided = true WHERE event_id = $1", [event.event_id]);
        await publish(db, { t: "event", event_id: event.event_id, player_id: event.player_id, type: event.type, points_delta: event.points_delta, voided: true });
      }
      return json(200, eventJson({ ...event, voided: true }));
    }),
  ),

  route("POST", "/api/operator/price-runs", "operator", async ({ body }) => {
    const input = objectBody(body);
    const runDate = typeof input.run_date === "string" ? input.run_date : "";
    return tx(async (db) => {
      const statuses = await db.query<{ status: string }>("SELECT status FROM gameweeks ORDER BY number FOR SHARE");
      await db.query("SELECT pg_advisory_xact_lock(7311002)");
      if (/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
        const used = await db.query("SELECT 1 FROM price_runs WHERE run_date::text = $1", [runDate]);
        if (used.rowCount) throw conflict("run_date_used", `A price change already ran for ${runDate}.`);
      }
      if (statuses.rows.some((row) => row.status === "locked" || row.status === "live")) {
        throw conflict("prices_frozen", "Prices are frozen until the gameweek closes.");
      }
      const date = new Date(`${runDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== runDate) {
        throw invalid({ run_date: "run_date is a real date written YYYY-MM-DD." });
      }
      const players = await playerIndex(db);
      const moves = Array.isArray(input.moves) ? (input.moves as Record<string, unknown>[]) : [];
      const ids = moves.map((move) => String(move?.player_id ?? ""));
      if (moves.length < 1 || moves.length > 200) throw invalid({ moves: "Send 1 to 200 moves." });
      if (!moves.every((move) => move?.delta_tenths === 1 || move?.delta_tenths === -1)) throw invalid({ moves: "Each move is one tenth up (1) or down (-1)." });
      if (!ids.every((id) => players.has(id))) throw invalid({ moves: "Every move names a seeded player." });
      if (new Set(ids).size !== ids.length) throw invalid({ moves: "A player can only move once per run." });
      const gameweek = await currentGameweek(db);
      await db.query("INSERT INTO price_runs (run_date, gameweek) VALUES ($1, $2)", [runDate, gameweek.number]);
      const moved = await db.query<{ player_id: string; moves: number }>(
        "SELECT player_id, count(*)::int AS moves FROM price_moves WHERE gameweek = $1 AND applied GROUP BY player_id",
        [gameweek.number],
      );
      const movesSoFar = new Map(moved.rows.map((row) => [row.player_id, row.moves]));
      const result: PriceRunResult = { run_date: runDate, applied: [], skipped: [] };
      for (const move of moves) {
        const player = players.get(String(move.player_id))!;
        const delta = move.delta_tenths as number;
        const applied = (movesSoFar.get(player.id) ?? 0) < PRICE_MOVES_PER_GAMEWEEK;
        const price = applied ? player.price_tenths + delta : player.price_tenths;
        await db.query(
          "INSERT INTO price_moves (run_date, player_id, delta_tenths, gameweek, applied, price_tenths) VALUES ($1, $2, $3, $4, $5, $6)",
          [runDate, player.id, delta, gameweek.number, applied, price],
        );
        if (!applied) {
          result.skipped.push({ player_id: player.id, reason: "gameweek_cap" });
          continue;
        }
        await db.query("UPDATE players SET price_tenths = $2 WHERE id = $1", [player.id, price]);
        result.applied.push({ player_id: player.id, delta_tenths: delta, price_tenths: price });
        const owners = await db.query<{ manager_id: string }>("SELECT manager_id FROM squad_players WHERE player_id = $1", [player.id]);
        for (const owner of owners.rows) {
          await queueNotice(db, owner.manager_id, "price_change", gameweek.number, noticeText.priceChange(player.name, price, delta > 0));
        }
      }
      await publish(db, { t: "prices" });
      return json(201, result);
    });
  }),
];

