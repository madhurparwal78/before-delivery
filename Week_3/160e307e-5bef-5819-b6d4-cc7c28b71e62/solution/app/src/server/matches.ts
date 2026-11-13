import { randomInt } from "node:crypto";
import { EMOTES, MODEL_VERSION, otherSeat } from "../shared/constants";
import { coinsOnBoard, colourOf, newMatchState, ruleEnd, ruleShot, ruleTimeout } from "../shared/rules";
import { checkShot, playShot } from "../shared/shot";
import type {
  Format,
  MatchState,
  PieceId,
  Seat,
  ShotEvents,
  ShotIntent,
  ShotOutcome,
} from "../shared/types";
import { config } from "./config";
import { query, rows, transaction } from "./db";
import type { Db, Row } from "./db";
import { ApiError } from "./errors";
import * as hub from "./hub";
import {
  DAILY_WIN_CHALK,
  MATCH_CHALK,
  WIN_CHALK,
  movementsToday,
  recordMovement,
} from "./ledger";
import { toPlayer } from "./players";
import type { Player } from "./players";
import { updateRating, twoDecimals } from "./ratings";
import { KeyedQueue, RateLimit, iso, remainingMs } from "./util";

/** Matches: state, shots, the shot clock, settlement and everything pushed to the two seats. */

export type Mode = "local" | "private" | "casual" | "ranked";
type Status = "waiting" | "active" | "completed" | "forfeit" | "abandoned";

interface MatchRow {
  id: string;
  mode: Mode;
  format: Format;
  status: Status;
  roomCode: string | null;
  seats: [string | null, string | null];
  ready: [boolean, boolean];
  state: MatchState;
  shotSeq: number;
  lastResult: Record<string, unknown> | null;
  lastResultSeat: number | null;
  lastWasShot: boolean;
  expired: [boolean, boolean];
  turnDeadline: Date | null;
  disconnect: [Date | null, Date | null];
  tossLine: string | null;
  firstBreaker: Seat | null;
  settlement: Settlement | null;
}

interface SeatSettlement {
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  chalk: number;
}
interface Settlement {
  seats: [SeatSettlement, SeatSettlement];
}

export const locks = new KeyedQueue();
const previewLimit = new RateLimit(15, 1000);
const emoteLimit = new RateLimit(1, 3000);
const lastPreview = new Map<string, Record<string, number>>();

function parseRow(row: Row): MatchRow {
  return {
    id: row.id as string,
    mode: row.mode as Mode,
    format: row.format as Format,
    status: row.status as Status,
    roomCode: (row.room_code as string | null) ?? null,
    seats: [(row.seat0 as string | null) ?? null, (row.seat1 as string | null) ?? null],
    ready: [row.ready0 as boolean, row.ready1 as boolean],
    state: row.state as MatchState,
    shotSeq: row.shot_seq as number,
    lastResult: (row.last_result as Record<string, unknown> | null) ?? null,
    lastResultSeat: (row.last_result_seat as number | null) ?? null,
    lastWasShot: row.last_was_shot as boolean,
    expired: [row.expired0 as boolean, row.expired1 as boolean],
    turnDeadline: (row.turn_deadline as Date | null) ?? null,
    disconnect: [(row.disconnect0 as Date | null) ?? null, (row.disconnect1 as Date | null) ?? null],
    tossLine: (row.toss_line as string | null) ?? null,
    firstBreaker: (row.first_breaker as Seat | null) ?? null,
    settlement: (row.settlement as Settlement | null) ?? null,
  };
}

export async function loadMatch(db: Db | null, id: string, lock = false): Promise<MatchRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const sql = `SELECT * FROM matches WHERE id = $1${lock ? " FOR UPDATE" : ""}`;
  const found = db ? await rows(db, sql, [id]) : await query(sql, [id]);
  return found[0] ? parseRow(found[0]) : null;
}

export function seatOf(match: MatchRow, playerId: string): Seat {
  if (match.seats[0] === playerId) return 0;
  if (match.seats[1] === playerId) return 1;
  throw new ApiError(403, "NOT_IN_MATCH");
}

async function seatPlayers(match: MatchRow, run?: Db): Promise<[Player | null, Player | null]> {
  const ids = match.seats.filter((s): s is string => s !== null);
  if (ids.length === 0) return [null, null];
  const found = run ? await rows(run, "SELECT * FROM players WHERE id = ANY($1)", [ids]) : await query("SELECT * FROM players WHERE id = ANY($1)", [ids]);
  const byId = new Map(found.map((r) => [r.id as string, toPlayer(r)]));
  return [match.seats[0] ? (byId.get(match.seats[0]) ?? null) : null, match.seats[1] ? (byId.get(match.seats[1]) ?? null) : null];
}

async function rematchJson(matchId: string): Promise<Record<string, unknown> | null> {
  const found = await query("SELECT offered_by, status, expires_at, new_match_id FROM rematches WHERE match_id = $1", [matchId]);
  const row = found[0];
  if (!row) return null;
  return {
    status: row.status,
    offeredBy: row.offered_by,
    matchId: row.new_match_id ?? null,
    remainingMs: row.status === "offered" ? remainingMs(row.expires_at) : null,
  };
}

export async function matchJson(match: MatchRow, run?: Db): Promise<Record<string, unknown>> {
  const players = await seatPlayers(match, run);
  const present = hub.presentSeats(match.id, match.seats);
  const state = match.state;
  const waiting = match.status === "waiting";
  return {
    id: match.id,
    mode: match.mode,
    format: match.format,
    status: match.status,
    board: state.board,
    turn: state.turn,
    phase: waiting ? "waiting" : state.finished || match.status === "abandoned" ? "match-over" : "aim",
    shotSeq: match.shotSeq,
    breakAttempt: state.breakAttempt,
    seats: ([0, 1] as const).map((seat) => {
      const player = players[seat];
      return {
        seat,
        playerId: match.seats[seat],
        name: player?.name ?? null,
        avatar: player?.avatar ?? null,
        color: colourOf(state, seat),
        score: state.scores[seat],
        coinsLeft: coinsOnBoard(state.pieces, state.white, seat).length,
        dues: state.dues[seat],
        timeouts: state.timeouts[seat],
        connected: present[seat],
        ready: waiting ? match.ready[seat] : match.seats[seat] !== null,
        strikerSkin: player?.equipped.striker ?? "striker-ply",
      };
    }),
    queen: state.queen,
    pieces: state.pieces,
    turnDeadline: iso(match.turnDeadline),
    turnRemainingMs: remainingMs(match.turnDeadline),
    winnerSeat: state.winnerSeat,
    endReason: state.endReason,
    roomCode: match.roomCode,
    toss: match.tossLine,
    settlement: match.settlement,
    rematch: state.finished && match.roomCode ? await rematchJson(match.id) : null,
  };
}

export async function pushState(matchId: string): Promise<void> {
  const match = await loadMatch(null, matchId);
  if (match) hub.toMatch(matchId, { type: "state", match: await matchJson(match) });
}

function statusOf(state: MatchState): Status {
  if (!state.finished) return "active";
  return state.endReason === "played" ? "completed" : "forfeit";
}

function tossWinner(): Seat {
  return config.tossSeed ?? (randomInt(2) as Seat);
}

function tossLineFor(name: string): string {
  return `${name} won the toss and breaks with white.`;
}

interface NewMatch {
  mode: Mode;
  format: Format;
  seats: [string | null, string | null];
  status: Status;
  state: MatchState;
  roomCode?: string | null;
  tossLine?: string | null;
  firstBreaker?: Seat | null;
  opponentName?: string | null;
  endedAt?: Date | null;
}

export async function insertMatch(db: Db, m: NewMatch): Promise<string> {
  const made = await rows(
    db,
    `INSERT INTO matches (mode, format, status, room_code, seat0, seat1, opponent_name, state, toss_line, first_breaker, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      m.mode,
      m.format,
      m.status,
      m.roomCode ?? null,
      m.seats[0],
      m.seats[1],
      m.opponentName ?? null,
      JSON.stringify(m.state),
      m.tossLine ?? null,
      m.firstBreaker ?? null,
      m.endedAt ?? null,
    ],
  );
  return (made[0] as Row).id as string;
}

/** A match that starts at once between two seated players (queue pairs). The toss decides the breaker. */
export async function createActiveMatch(db: Db, mode: Mode, format: Format, players: [Player, Player]): Promise<string> {
  const winner = tossWinner();
  return insertMatch(db, {
    mode,
    format,
    seats: [players[0].id, players[1].id],
    status: "active",
    state: newMatchState(format, winner),
    tossLine: tossLineFor(players[winner].name),
    firstBreaker: winner,
  });
}

async function startClockIfNeeded(matchId: string): Promise<void> {
  const deadline = new Date(Date.now() + config.shotTimerSeconds * 1000);
  await query("UPDATE matches SET turn_deadline = $2 WHERE id = $1 AND status = 'active' AND turn_deadline IS NULL", [matchId, deadline]);
}

// ---------------------------------------------------------------------------------------------
// settlement: ratings and chalk, once, in the transaction that finishes the match

async function settle(db: Db, match: MatchRow): Promise<Settlement | null> {
  const state = match.state;
  if (match.mode === "local" || state.winnerSeat === null) return null;
  const winner = state.winnerSeat;
  const loser = otherSeat(winner);
  const [first, second] = match.seats as [string, string];
  const ids = [first, second].sort();
  const locked = await rows(db, "SELECT * FROM players WHERE id = ANY($1) ORDER BY id FOR UPDATE", [ids]);
  const players = new Map(locked.map((r) => [r.id as string, toPlayer(r)]));
  const seatPlayer = (seat: Seat): Player => players.get(match.seats[seat] as string) as Player;
  const out: [SeatSettlement, SeatSettlement] = [
    { ratingBefore: null, ratingAfter: null, ratingDelta: null, chalk: 0 },
    { ratingBefore: null, ratingAfter: null, ratingDelta: null, chalk: 0 },
  ];

  if (match.mode === "ranked") {
    const before = [seatPlayer(0), seatPlayer(1)] as const;
    for (const seat of [0, 1] as const) {
      const me = before[seat];
      const them = before[otherSeat(seat)];
      const next = updateRating(me, them, seat === winner ? 1 : 0);
      const delta = next.rating - me.rating;
      out[seat] = { ratingBefore: twoDecimals(me.rating), ratingAfter: twoDecimals(next.rating), ratingDelta: twoDecimals(delta), chalk: 0 };
      await db.query(
        "UPDATE players SET rating = $2, rd = $3, volatility = $4, ranked_games = ranked_games + 1 WHERE id = $1",
        [me.id, next.rating, next.rd, next.volatility],
      );
      await db.query(
        `INSERT INTO rating_changes (match_id, player_id, rating_before, rating_after, rd_before, rd_after, volatility_after, delta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [match.id, me.id, me.rating, next.rating, me.rd, next.rd, next.volatility, delta],
      );
    }
  }

  const forfeiter: Seat | null = state.endReason === "played" ? null : loser;
  for (const seat of [0, 1] as const) {
    const playerId = match.seats[seat] as string;
    let earned = 0;
    if (seat !== forfeiter) {
      await recordMovement(db, playerId, MATCH_CHALK, "match", { matchId: match.id });
      earned += MATCH_CHALK;
    }
    if (seat === winner) {
      await recordMovement(db, playerId, WIN_CHALK, "win", { matchId: match.id });
      earned += WIN_CHALK;
      if ((await movementsToday(db, playerId, "daily")) === 0) {
        await recordMovement(db, playerId, DAILY_WIN_CHALK, "daily", { matchId: match.id });
        earned += DAILY_WIN_CHALK;
      }
    }
    out[seat].chalk = earned;
  }
  return { seats: out };
}

// ---------------------------------------------------------------------------------------------
// committing a ruling

function resultJson(match: MatchRow, outcome: ShotOutcome, seat: Seat, matchView: Record<string, unknown>): Record<string, unknown> {
  return {
    shotSeq: match.shotSeq,
    seat,
    events: outcome.events,
    verdict: outcome.verdict,
    frames: outcome.frames,
    final: outcome.final,
    boardEnd: outcome.boardEnd,
    match: matchView,
  };
}

async function commitRuling(
  db: Db,
  match: MatchRow,
  seat: Seat,
  outcome: ShotOutcome,
  detail: { intent: ShotIntent | null; wasShot: boolean },
): Promise<Record<string, unknown>> {
  const board = match.state.board;
  match.state = outcome.next;
  match.shotSeq += 1;
  match.status = statusOf(outcome.next);
  match.lastWasShot = detail.wasShot;
  match.lastResultSeat = seat;
  match.expired = detail.wasShot ? [false, false] : (match.expired.map((v, i) => (i === seat ? true : v)) as [boolean, boolean]);
  match.turnDeadline = outcome.next.finished ? null : new Date(Date.now() + config.shotTimerSeconds * 1000);
  if (outcome.next.finished) {
    match.settlement = await settle(db, match);
    lastPreview.delete(`${match.id}:0`);
    lastPreview.delete(`${match.id}:1`);
  }
  await db.query(
    `INSERT INTO shots (match_id, seq, seat, board, intent, events, verdict) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [match.id, match.shotSeq, seat, board, detail.intent ? JSON.stringify(detail.intent) : null, JSON.stringify(outcome.events), JSON.stringify(outcome.verdict)],
  );
  if (outcome.boardEnd) {
    await db.query("INSERT INTO boards (match_id, board, winner_seat, points, line) VALUES ($1, $2, $3, $4, $5)", [
      match.id,
      outcome.boardEnd.board,
      outcome.boardEnd.winnerSeat,
      outcome.boardEnd.points,
      outcome.boardEnd.line,
    ]);
  }
  const view = await matchJson(match, db);
  const result = resultJson(match, outcome, seat, view);
  match.lastResult = result;
  await db.query(
    `UPDATE matches SET status = $2, state = $3, shot_seq = $4, last_result = $5, last_result_seat = $6, last_was_shot = $7,
            expired0 = $8, expired1 = $9, turn_deadline = $10, settlement = $11, ended_at = CASE WHEN $12 THEN now() ELSE ended_at END
      WHERE id = $1`,
    [
      match.id,
      match.status,
      JSON.stringify(match.state),
      match.shotSeq,
      JSON.stringify(result),
      seat,
      detail.wasShot,
      match.expired[0],
      match.expired[1],
      match.turnDeadline,
      match.settlement ? JSON.stringify(match.settlement) : null,
      match.state.finished,
    ],
  );
  return result;
}

function broadcastResult(matchId: string, result: Record<string, unknown>): void {
  hub.toMatch(matchId, { type: "shotResult", ...result });
}

export interface ShotBody {
  shotSeq: number;
  x: number;
  dx: number;
  dy: number;
  p: number;
  modelVersion: string;
}

/** A shot body from HTTP or the socket: the shot's own numbers are judged by the laws, its envelope here. */
export function parseShotBody(input: Record<string, unknown>): ShotBody {
  if (!Number.isInteger(input.shotSeq)) throw new ApiError(400, "INVALID_PAYLOAD");
  return {
    shotSeq: input.shotSeq as number,
    x: input.x as number,
    dx: input.dx as number,
    dy: input.dy as number,
    p: input.p as number,
    modelVersion: String(input.modelVersion),
  };
}

export function submitShot(playerId: string, matchId: string, body: ShotBody): Promise<Record<string, unknown>> {
  return locks.run(matchId, async () => {
    const result = await transaction(async (db) => {
      const match = await loadMatch(db, matchId, true);
      if (!match) throw new ApiError(404, "NOT_FOUND");
      const seat = seatOf(match, playerId);
      if (match.lastWasShot && match.lastResultSeat === seat && body.shotSeq === match.shotSeq && match.lastResult) {
        return { stored: match.lastResult, fresh: false };
      }
      if (body.modelVersion !== MODEL_VERSION) throw new ApiError(409, "CLIENT_OUTDATED");
      if (match.status !== "active") throw new ApiError(409, "MATCH_NOT_ACTIVE");
      if (match.state.turn !== seat) throw new ApiError(409, match.expired[seat] ? "TURN_EXPIRED" : "NOT_YOUR_TURN");
      if (body.shotSeq !== match.shotSeq + 1) throw new ApiError(409, "STALE_SEQ");
      const intent: ShotIntent = { x: body.x, dx: body.dx, dy: body.dy, p: body.p };
      const check = checkShot(match.state, seat, intent);
      if (check !== "ok") throw new ApiError(422, check);
      hub.toMatch(matchId, { type: "shotStarted", shotSeq: match.shotSeq + 1, seat });
      const outcome = playShot(match.state, seat, intent);
      return { stored: await commitRuling(db, match, seat, outcome, { intent, wasShot: true }), fresh: true };
    });
    if (result.fresh) broadcastResult(matchId, result.stored);
    return result.stored;
  });
}

/** The grading route: applies events through the laws exactly as if the server had simulated the shot. */
export function gradingShot(
  matchId: string,
  seat: Seat,
  events: ShotEvents,
  final: readonly { id: PieceId; x: number; y: number }[],
): Promise<Record<string, unknown>> {
  return locks.run(matchId, async () => {
    const result = await transaction(async (db) => {
      const match = await loadMatch(db, matchId, true);
      if (!match) throw new ApiError(404, "NOT_FOUND");
      if (match.status !== "active") throw new ApiError(409, "MATCH_NOT_ACTIVE");
      if (match.state.turn !== seat) throw new ApiError(409, "NOT_YOUR_TURN");
      hub.toMatch(matchId, { type: "shotStarted", shotSeq: match.shotSeq + 1, seat });
      const positions = new Map(final.map((f) => [f.id, { x: f.x, y: f.y }]));
      const outcome = ruleShot(match.state, seat, events, positions);
      return commitRuling(db, match, seat, outcome, { intent: null, wasShot: true });
    });
    broadcastResult(matchId, result);
    return result;
  });
}

function timeoutOnce(matchId: string): Promise<void> {
  return locks.run(matchId, async () => {
    const result = await transaction(async (db) => {
      const match = await loadMatch(db, matchId, true);
      if (!match || match.status !== "active" || !match.turnDeadline || match.turnDeadline.getTime() > Date.now()) return null;
      return commitRuling(db, match, match.state.turn, ruleTimeout(match.state), { intent: null, wasShot: false });
    });
    if (result) broadcastResult(matchId, result);
  });
}

async function finishWith(db: Db, match: MatchRow, state: MatchState): Promise<void> {
  match.state = state;
  match.status = statusOf(state);
  match.turnDeadline = null;
  match.settlement = await settle(db, match);
  await db.query("UPDATE matches SET status = $2, state = $3, turn_deadline = NULL, settlement = $4, ended_at = now() WHERE id = $1", [
    match.id,
    match.status,
    JSON.stringify(state),
    match.settlement ? JSON.stringify(match.settlement) : null,
  ]);
}

export function resign(playerId: string, matchId: string): Promise<Record<string, unknown>> {
  return locks.run(matchId, async () => {
    const view = await transaction(async (db) => {
      const match = await loadMatch(db, matchId, true);
      if (!match) throw new ApiError(404, "NOT_FOUND");
      const seat = seatOf(match, playerId);
      if (match.status !== "active") throw new ApiError(409, "MATCH_NOT_ACTIVE");
      await finishWith(db, match, ruleEnd(match.state, seat, "resigned"));
      return matchJson(match, db);
    });
    hub.toMatch(matchId, { type: "state", match: view });
    return view;
  });
}

function endMatch(matchId: string, loser: Seat | "both"): Promise<void> {
  return locks.run(matchId, async () => {
    const view = await transaction(async (db) => {
      const match = await loadMatch(db, matchId, true);
      if (!match || match.status !== "active") return null;
      if (loser === "both") {
        match.status = "abandoned";
        match.turnDeadline = null;
        await db.query("UPDATE matches SET status = 'abandoned', turn_deadline = NULL, ended_at = now() WHERE id = $1", [matchId]);
      } else {
        await finishWith(db, match, ruleEnd(match.state, loser, "left"));
      }
      return matchJson(match, db);
    });
    if (view) hub.toMatch(matchId, { type: "state", match: view });
  });
}

export function setReady(playerId: string, matchId: string): Promise<Record<string, unknown>> {
  return locks.run(matchId, async () => {
    const view = await transaction(async (db) => {
      const match = await loadMatch(db, matchId, true);
      if (!match) throw new ApiError(404, "NOT_FOUND");
      const seat = seatOf(match, playerId);
      if (match.status !== "waiting") throw new ApiError(409, "MATCH_NOT_WAITING");
      match.ready[seat] = true;
      await db.query(`UPDATE matches SET ready${seat} = true WHERE id = $1`, [matchId]);
      if (match.ready[0] && match.ready[1] && match.seats[0] && match.seats[1]) {
        const winner = tossWinner();
        const players = await seatPlayers(match, db);
        match.state = newMatchState(match.format, winner);
        match.status = "active";
        match.firstBreaker = winner;
        match.tossLine = tossLineFor((players[winner] as Player).name);
        await db.query("UPDATE matches SET status = 'active', state = $2, toss_line = $3, first_breaker = $4 WHERE id = $1", [
          matchId,
          JSON.stringify(match.state),
          match.tossLine,
          winner,
        ]);
      }
      return matchJson(match, db);
    });
    hub.toMatch(matchId, { type: "state", match: view });
    return view;
  });
}

// ---------------------------------------------------------------------------------------------
// previews and emotes

export async function preview(playerId: string, matchId: string, body: Record<string, unknown>): Promise<void> {
  const match = await loadMatch(null, matchId);
  if (!match) throw new ApiError(404, "NOT_FOUND");
  const seat = seatOf(match, playerId);
  if (!previewLimit.take(`${matchId}:${playerId}`)) throw new ApiError(429, "RATE_LIMITED");
  if (match.status !== "active" || match.state.turn !== seat) return;
  const key = `${matchId}:${seat}`;
  const merged = { ...(lastPreview.get(key) ?? { x: 0, dx: 0, dy: -1, p: 0 }) };
  for (const field of ["x", "dx", "dy", "p"] as const) {
    const value = body[field];
    if (typeof value === "number" && Number.isFinite(value)) merged[field] = value;
  }
  lastPreview.set(key, merged);
  hub.toMatch(matchId, { type: "preview", seat, ...merged }, (c) => c.playerId !== playerId);
}

export async function sendEmote(playerId: string, matchId: string, emote: unknown): Promise<void> {
  const match = await loadMatch(null, matchId);
  if (!match) throw new ApiError(404, "NOT_FOUND");
  const seat = seatOf(match, playerId);
  if (!emoteLimit.take(`${matchId}:${playerId}`)) throw new ApiError(429, "RATE_LIMITED");
  if (typeof emote !== "string" || !EMOTES.some(([id]) => id === emote)) throw new ApiError(422, "INVALID_EMOTE");
  hub.toMatch(matchId, { type: "emote", seat, emote });
}

// ---------------------------------------------------------------------------------------------
// presence and the sweepers

export function joinedMatch(connection: hub.Connection): Promise<void> {
  const matchId = connection.matchId;
  if (!matchId) return Promise.resolve();
  return locks.run(matchId, async () => {
    const match = await loadMatch(null, matchId);
    if (!match) return;
    const seat = match.seats[0] === connection.playerId ? 0 : match.seats[1] === connection.playerId ? 1 : null;
    if (seat === null) {
      hub.send(connection, { type: "error", code: "NOT_IN_MATCH" });
      connection.socket.close();
      return;
    }
    if (match.status === "active") {
      await query(`UPDATE matches SET disconnect${seat} = NULL WHERE id = $1`, [matchId]);
      await startClockIfNeeded(matchId);
    }
    const fresh = await loadMatch(null, matchId);
    if (!fresh) return;
    hub.send(connection, { type: "state", match: await matchJson(fresh) });
    hub.toMatch(matchId, { type: "state", match: await matchJson(fresh) }, (c) => c !== connection);
    hub.send(connection, opponentStatus(fresh, seat));
    hub.toMatch(matchId, opponentStatus(fresh, otherSeat(seat)), (c) => c.playerId === fresh.seats[otherSeat(seat)]);
  });
}

function opponentStatus(match: MatchRow, viewerSeat: Seat): Record<string, unknown> {
  const other = otherSeat(viewerSeat);
  const present = hub.presentSeats(match.id, match.seats)[other];
  const deadline = match.disconnect[other];
  return {
    type: "opponentStatus",
    connected: present || match.status !== "active" || deadline === null,
    reconnectDeadline: present ? null : iso(deadline),
    reconnectRemainingMs: present ? null : remainingMs(deadline),
  };
}

export function leftMatch(connection: hub.Connection): Promise<void> {
  const matchId = connection.matchId;
  if (!matchId) return Promise.resolve();
  return locks.run(matchId, async () => {
    const match = await loadMatch(null, matchId);
    if (!match) return;
    const seat = match.seats[0] === connection.playerId ? 0 : match.seats[1] === connection.playerId ? 1 : null;
    if (seat === null || hub.isPresent(matchId, connection.playerId)) return;
    if (match.status === "active") {
      const deadline = new Date(Date.now() + config.reconnectSeconds * 1000);
      await query(`UPDATE matches SET disconnect${seat} = $2 WHERE id = $1`, [matchId, deadline]);
    }
    const fresh = await loadMatch(null, matchId);
    if (!fresh) return;
    hub.toMatch(matchId, opponentStatus(fresh, otherSeat(seat)), (c) => c.playerId === fresh.seats[otherSeat(seat)]);
    hub.toMatch(matchId, { type: "state", match: await matchJson(fresh) });
  });
}

/** Rules every shot clock that ran out and every reconnect window that closed. */
export async function sweepMatches(): Promise<void> {
  const now = new Date();
  const due = await query(
    `SELECT id, turn_deadline, disconnect0, disconnect1, seat0, seat1 FROM matches
      WHERE status = 'active' AND (turn_deadline <= $1 OR disconnect0 <= $1 OR disconnect1 <= $1)`,
    [now],
  );
  for (const row of due) {
    const id = row.id as string;
    const gone = ([0, 1] as const).filter((s) => {
      const deadline = row[`disconnect${s}`] as Date | null;
      return deadline !== null && deadline.getTime() <= now.getTime();
    });
    const first = gone[0];
    if (first !== undefined) {
      const opponentHere = hub.isPresent(id, row[`seat${otherSeat(first)}`] as string);
      await endMatch(id, opponentHere ? first : "both");
    } else {
      await timeoutOnce(id);
    }
  }
}
