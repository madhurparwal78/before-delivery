import { randomUUID } from 'node:crypto';
import {
  CALL_A_POCKET,
  COIN_CHANGE_NONE,
  coinChangeLost,
  coinChangeReturned,
  coinChangeWon,
  levelUpLine,
  shotReceipt,
  xpGained,
} from '../shared/copy.js';
import { SHOP_ITEMS, applyXp, tierOf } from '../shared/catalog.js';
import { simulateShot, scatterPositions } from '../shared/physics.js';
import { ballsLeft, applyShot, newMatchState, otherSeat } from '../shared/referee.js';
import { FOOT_SPOT, HEAD_SPOT, predictFirstBall, rackPositions } from '../shared/table-geometry.js';
import type { Announcement, MatchState, Mode, Pocket, Point, ResultCase, Seat, ShotInput, ShotOutcome } from '../shared/types.js';
import { groupLabel, resolveAnnouncement, resultLine, turnText } from '../shared/view.js';
import { config } from './config.js';
import { direct, query, queryOne, transaction, type Queryable } from './db.js';
import { ApiError } from './errors.js';
import { publish, tableViewers, send } from './events.js';
import { fromEscrow, houseCut, toEscrow, credit } from './ledger.js';
import { weekStart } from './players.js';

export type MatchKind = 'stake' | 'private' | 'tournament';

export interface SeatStat {
  aim: number;
  power: number;
  spin: number;
  time: number;
}

export interface MatchRow {
  id: string;
  mode: Mode;
  tier: number | null;
  kind: MatchKind;
  status: string;
  entry: string | number;
  pot: string | number;
  seat1: string | null;
  seat2: string | null;
  seat1_session: string | null;
  seat2_session: string | null;
  state: MatchState;
  script: ShotOutcome[] | null;
  script_index: number;
  winner_seat: number | null;
  result_case: ResultCase | null;
  tournament_id: string | null;
  tournament_round: string | null;
  host_id: string | null;
  seat_stats: Record<string, SeatStat>;
  settlement: Record<string, { xp: number; levelUps: number[]; coins: number }> | null;
}

export interface Room {
  id: string;
  expiredSeat: Seat | null;
  shotDeadline: number | null;
  timedOutTurns: Record<Seat, number>;
  announcements: Announcement[];
  banner: Announcement | null;
  receipt: Record<Seat, string>;
  rematch: Set<Seat>;
  seatSeen: Record<Seat, number>;
  droppedSince: Record<Seat, number | null>;
  names: Record<Seat, string>;
}

const rooms = new Map<string, Room>();

export function roomOf(match: MatchRow, names: Record<Seat, string>): Room {
  let room = rooms.get(match.id);
  if (!room) {
    room = {
      id: match.id,
      shotDeadline: match.status === 'in_play' ? Date.now() + shotClockFor(match, match.state.activeSeat) * 1000 : null,
      expiredSeat: null,
      timedOutTurns: { 1: 0, 2: 0 },
      announcements: [],
      banner: null,
      receipt: { 1: '', 2: '' },
      rematch: new Set(),
      seatSeen: { 1: 0, 2: 0 },
      droppedSince: { 1: null, 2: null },
      names,
    };
    if (match.state.calledPocketRequired) {
      const opening: Announcement = { type: 'plain', text: CALL_A_POCKET };
      room.announcements.push(opening);
      room.banner = opening;
    }
    rooms.set(match.id, room);
  }
  room.names = names;
  return room;
}

export function shotClockFor(match: MatchRow, seat: Seat): number {
  const stat = match.seat_stats[String(seat)];
  return config.shotClockSeconds + (stat?.time ?? 0);
}

export async function seatStatsFor(playerId: string | null): Promise<SeatStat> {
  if (!playerId) return { aim: 0, power: 0, spin: 0, time: 0 };
  const row = await queryOne<{ equipped_cue_id: string | null }>(`SELECT equipped_cue_id FROM players WHERE id = $1`, [playerId]);
  const cue = SHOP_ITEMS.find((item) => item.id === row?.equipped_cue_id);
  if (!cue) return { aim: 0, power: 0, spin: 0, time: 0 };
  return { aim: cue.aim, power: cue.power, spin: cue.spin, time: cue.time };
}

export async function loadMatch(id: string): Promise<MatchRow | null> {
  if (!isUuid(id)) return null;
  return queryOne<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [id]);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function seatOf(match: MatchRow, playerId: string): Seat | null {
  if (match.seat1 === playerId) return 1;
  if (match.seat2 === playerId) return 2;
  return null;
}

export async function namesOf(match: MatchRow): Promise<Record<Seat, string>> {
  const ids = [match.seat1, match.seat2].filter((id): id is string => Boolean(id));
  const rows = ids.length
    ? await query<{ id: string; display_name: string }>(`SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])`, [ids])
    : [];
  const byId = new Map(rows.map((row) => [row.id, row.display_name]));
  return {
    1: match.seat1 ? byId.get(match.seat1) ?? 'Player 1' : 'Waiting',
    2: match.seat2 ? byId.get(match.seat2) ?? 'Player 2' : 'Waiting',
  };
}

/** A grading or tournament table is created with no session: the first session to arrive takes the seat. */
export async function claimSeat(match: MatchRow, seat: Seat, sessionId: string): Promise<boolean> {
  const column = seat === 1 ? 'seat1_session' : 'seat2_session';
  const current = seat === 1 ? match.seat1_session : match.seat2_session;
  if (current === sessionId) return true;
  const room = rooms.get(match.id);
  const seen = room?.seatSeen[seat] ?? 0;
  const seatedLive = current !== null && Date.now() - seen < 6000;
  if (seatedLive) return false;
  await query(`UPDATE matches SET ${column} = $1 WHERE id = $2`, [sessionId, match.id]);
  if (seat === 1) match.seat1_session = sessionId;
  else match.seat2_session = sessionId;
  return true;
}

export function markSeatSeen(match: MatchRow, seat: Seat, names: Record<Seat, string>): void {
  const room = roomOf(match, names);
  room.seatSeen[seat] = Date.now();
  room.droppedSince[seat] = null;
}

export interface TableView {
  playerId: string | null;
  sessionId: string | null;
}

export async function tableBody(match: MatchRow, view: TableView): Promise<Record<string, unknown>> {
  const names = await namesOf(match);
  const room = roomOf(match, names);
  const seat = view.playerId ? seatOf(match, view.playerId) : null;
  const seatedHere = seat !== null && (seat === 1 ? match.seat1_session : match.seat2_session) === view.sessionId;
  const viewer = { seat, names };
  const state = match.state;
  const remaining = room.shotDeadline && match.status === 'in_play' ? Math.max(0, Math.ceil((room.shotDeadline - Date.now()) / 1000)) : null;
  const droppedSeat: Seat | null = room.droppedSince[1] ? 1 : room.droppedSince[2] ? 2 : null;
  const reconnectSeconds = droppedSeat
    ? Math.max(0, Math.ceil((config.reconnectGraceSeconds * 1000 - (Date.now() - (room.droppedSince[droppedSeat] as number))) / 1000))
    : null;
  const settlement = match.settlement ?? null;
  const result =
    match.status === 'settled' || match.status === 'forfeited' || match.status === 'voided'
      ? resultFor(match, seat, viewer.names, settlement)
      : null;

  return {
    id: match.id,
    mode: match.mode,
    tier: match.tier,
    kind: match.kind,
    status: match.status,
    seats: ([1, 2] as Seat[]).map((index) => ({
      seat: index,
      playerId: index === 1 ? match.seat1 : match.seat2,
      displayName: names[index],
      group: state.groups[index],
      ballsLeft: ballsLeft(state, index),
      connected: room.droppedSince[index] === null,
    })),
    activeSeat: state.activeSeat,
    ballInHand: state.ballInHand && seat === state.activeSeat ? true : state.ballInHand,
    behindHeadString: state.behindHeadString,
    calledPocketRequired: state.calledPocketRequired,
    shotClockSeconds: remaining,
    reconnectSeconds,
    droppedName: droppedSeat ? names[droppedSeat] : null,
    pot: Number(match.pot),
    entry: Number(match.entry),
    seatedHere,
    ruleBanner: room.banner ? resolveAnnouncement(room.banner, viewer) : '',
    balls: state.balls,
    ballPositions: Object.entries(state.positions).map(([ball, point]) => ({
      ball: Number(ball),
      across: Math.round(point.across * 10) / 10,
      along: Math.round(point.along * 10) / 10,
    })),
    announcements: room.announcements.map((item) => resolveAnnouncement(item, viewer)),
    turn: turnText(state, viewer),
    groupLabels: { 1: groupLabel(state.groups[1]), 2: groupLabel(state.groups[2]) },
    shotReceipt: seat ? room.receipt[seat] : '',
    rematchWaitingFor: room.rematch.size > 0 ? [...room.rematch] : [],
    result,
  };
}

function resultFor(
  match: MatchRow,
  seat: Seat | null,
  names: Record<Seat, string>,
  settlement: Record<string, { xp: number; levelUps: number[]; coins: number }> | null,
): Record<string, unknown> | null {
  const resultCase = (match.result_case ?? 'void') as ResultCase;
  const winnerSeat = (match.winner_seat as Seat | null) ?? null;
  const line = resultLine(seat, winnerSeat, resultCase, names);
  const entry = Number(match.entry);
  const pot = Number(match.pot);
  let coinChange = COIN_CHANGE_NONE;
  if (match.kind === 'stake' && entry > 0) {
    if (resultCase === 'void') coinChange = coinChangeReturned(entry);
    else if (seat !== null && seat === winnerSeat) coinChange = coinChangeWon(pot);
    else coinChange = coinChangeLost(entry);
  }
  const mine = seat !== null ? settlement?.[String(seat)] : undefined;
  return {
    line,
    coinChange,
    xpGained: mine?.xp ?? 0,
    levelUps: mine?.levelUps ?? [],
    coins: mine?.coins ?? 0,
    xpGainedText: xpGained(mine?.xp ?? 0),
    levelUpLines: (mine?.levelUps ?? []).map((level) => levelUpLine(level)),
  };
}

export async function publishTable(matchId: string): Promise<void> {
  const match = await loadMatch(matchId);
  if (!match) return;
  const viewers = tableViewers(matchId);
  for (const client of viewers) {
    const body = await tableBody(match, { playerId: client.playerId, sessionId: client.sessionId });
    send(client, 'table', body);
  }
}

export function publishPlayer(playerId: string): void {
  publish(`player:${playerId}`, 'player', { changed: true });
}

export interface CreateMatchOptions {
  mode: Mode;
  tier: number | null;
  kind: MatchKind;
  seat1: string | null;
  seat2: string | null;
  seat1Session?: string | null;
  seat2Session?: string | null;
  status: string;
  entry: number;
  pot: number;
  script?: ShotOutcome[] | null;
  state?: MatchState;
  tournamentId?: string | null;
  tournamentRound?: string | null;
  hostId?: string | null;
  client?: Queryable;
}

export async function createMatchRow(options: CreateMatchOptions): Promise<MatchRow> {
  const id = randomUUID();
  const state = options.state ?? freshState(options.mode);
  const stats: Record<string, SeatStat> = {
    1: await seatStatsFor(options.seat1),
    2: await seatStatsFor(options.seat2),
  };
  const runner = options.client ?? direct;
  const result = await runner.query<MatchRow>(
    `INSERT INTO matches (id, mode, tier, kind, status, entry, pot, seat1, seat2, seat1_session, seat2_session, state, script, tournament_id, host_id, seat_stats, tournament_round)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [
      id,
      options.mode,
      options.tier,
      options.kind,
      options.status,
      options.entry,
      options.pot,
      options.seat1,
      options.seat2,
      options.seat1Session ?? null,
      options.seat2Session ?? null,
      JSON.stringify(state),
      options.script ? JSON.stringify(options.script) : null,
      options.tournamentId ?? null,
      options.hostId ?? null,
      JSON.stringify(stats),
      options.tournamentRound ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('match insert failed');
  return row;
}

export function freshState(mode: Mode): MatchState {
  const positions = rackPositions(mode);
  const balls = Object.keys(positions).map((key) => Number(key));
  return newMatchState(mode, positions, balls);
}

export async function saveState(match: MatchRow): Promise<void> {
  await query(`UPDATE matches SET state = $1, script_index = $2 WHERE id = $3`, [JSON.stringify(match.state), match.script_index, match.id]);
}

export interface ShotRequest {
  shot: ShotInput;
  seat: Seat;
}

export async function takeShot(match: MatchRow, request: ShotRequest): Promise<void> {
  const names = await namesOf(match);
  const room = roomOf(match, names);
  const state = match.state;
  const cueBall = state.positions[0] ?? { ...HEAD_SPOT };
  let outcome: ShotOutcome;
  let positions: Record<number, Point>;
  const scripted = match.script && request.shot.power > 0 ? match.script[match.script_index] : undefined;
  if (match.script && request.shot.power > 0) {
    if (!scripted) throw new ApiError(409, 'script_exhausted', 'This table has no scripted shots left.');
    outcome = normaliseOutcome(scripted);
    match.script_index += 1;
    const remaining = state.balls.filter((ball) => !outcome.pocketed.some((entry) => entry.ball === ball));
    positions = scriptedPositions(remaining, match.script[match.script_index]?.firstContact ?? null);
  } else {
    const simulated = simulateShot(cueBall, state.balls, state.positions, request.shot);
    outcome = simulated.outcome;
    positions = { ...simulated.positions, 0: simulated.cueBall };
  }

  const prediction = predictFirstBall(cueBall, request.shot.aimDegrees, state.positions, state.balls);
  const first = outcome.firstContact;
  const cutAngle =
    first === null
      ? null
      : prediction.ball === first && prediction.cutAngle !== null
        ? prediction.cutAngle
        : angleBetween(cueBall, request.shot.aimDegrees, state.positions[first]);
  room.receipt[request.seat] = shotReceipt(first, cutAngle);

  const ruling = applyShot({
    state,
    seat: request.seat,
    outcome,
    calledPocket: request.shot.calledPocket,
    names,
    positions,
  });

  await query(
    `INSERT INTO shots (id, match_id, seat, aim_degrees, power, side_spin, top_spin, called_pocket, outcome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), match.id, request.seat, request.shot.aimDegrees, request.shot.power, request.shot.sideSpin, request.shot.topSpin, request.shot.calledPocket, JSON.stringify(outcome)],
  );

  match.state = ruling.state;
  room.announcements.push(...ruling.announcements);
  room.banner = ruling.banner;
  room.timedOutTurns[request.seat] = 0;
  room.expiredSeat = null;
  await saveState(match);

  if (ruling.winnerSeat && ruling.resultCase) {
    await settleMatch(match, ruling.winnerSeat, ruling.resultCase);
  } else {
    room.shotDeadline = Date.now() + shotClockFor(match, ruling.state.activeSeat) * 1000;
  }
  await publishTable(match.id);
}

/** The cut angle between the shot line and the ball actually struck. */
function angleBetween(cueBall: Point, aimDegrees: number, ball: Point | undefined): number | null {
  if (!ball) return null;
  const radians = (aimDegrees * Math.PI) / 180;
  const direction = { x: Math.sin(radians), y: Math.cos(radians) };
  const to = { x: ball.across - cueBall.across, y: (ball.along - cueBall.along) * 2 };
  const length = Math.hypot(to.x, to.y);
  if (length === 0) return 0;
  const dot = Math.min(1, Math.max(-1, (to.x * direction.x + to.y * direction.y) / length));
  return Math.round(((Math.acos(dot) * 180) / Math.PI) * 10) / 10;
}

/**
 * Scripted tables jump balls to rest. The next scripted first ball sits on the
 * starting aim line so the loupe, guideline and receipt read sensibly.
 */
export function scriptedPositions(balls: number[], nextFirstContact: number | null): Record<number, Point> {
  const positions: Record<number, Point> = { 0: { ...HEAD_SPOT } };
  const others = balls.filter((ball) => ball !== nextFirstContact);
  const scattered = scatterPositions(others, 20250101 + others.length);
  for (const ball of others) {
    const point = scattered[ball];
    if (!point) continue;
    const across = point.across > 40 && point.across < 60 ? point.across + 22 : point.across;
    positions[ball] = { across: Math.min(88, across), along: Math.max(45, point.along) };
  }
  if (nextFirstContact !== null && balls.includes(nextFirstContact)) {
    positions[nextFirstContact] = { ...FOOT_SPOT };
  }
  return positions;
}

function normaliseOutcome(entry: ShotOutcome): ShotOutcome {
  return {
    firstContact: entry.firstContact ?? null,
    pocketed: Array.isArray(entry.pocketed) ? entry.pocketed : [],
    cushion: Boolean(entry.cushion),
    scratch: Boolean(entry.scratch),
    offTable: Array.isArray(entry.offTable) ? entry.offTable : [],
  };
}

export async function placeBall(match: MatchRow, seat: Seat, across: number, along: number): Promise<void> {
  const state = match.state;
  state.positions[0] = { across, along };
  state.ballInHand = false;
  state.behindHeadString = false;
  state.activeSeat = seat;
  await saveState(match);
  await publishTable(match.id);
}

/** Settlement: Coins, XP, level, record and ledger in one transaction. */
export async function settleMatch(match: MatchRow, winnerSeat: Seat, resultCase: ResultCase): Promise<void> {
  const loserSeat = otherSeat(winnerSeat);
  const tier = match.tier ? tierOf(match.tier) : null;
  const entry = Number(match.entry);
  const pot = Number(match.pot);
  const settlement = await transaction(async (client) => {
    const locked = await client.query<MatchRow>(`SELECT * FROM matches WHERE id = $1 FOR UPDATE`, [match.id]);
    const row = locked.rows[0];
    if (!row || row.status !== 'in_play') return null;
    const winnerId = winnerSeat === 1 ? row.seat1 : row.seat2;
    const loserId = loserSeat === 1 ? row.seat1 : row.seat2;
    const counts = match.kind !== 'private';
    const perSeat: Record<string, { xp: number; levelUps: number[]; coins: number }> = {};

    if (match.kind === 'stake' && entry > 0 && winnerId) {
      await fromEscrow(client, winnerId, pot, 'match_win', match.id);
      const cut = entry * 2 - pot;
      if (cut > 0) await houseCut(client, cut, match.id);
    }

    for (const [seat, playerId] of [
      [winnerSeat, winnerId],
      [loserSeat, loserId],
    ] as const) {
      if (!playerId) continue;
      const won = seat === winnerSeat;
      const gained = counts && tier ? tier.tier * (won ? 60 : 20) : 0;
      const current = await client.query<{ level: number; xp: number; coins: string; wins: number; losses: number; win_streak: number; highest_pot: string }>(
        `SELECT level, xp, coins, wins, losses, win_streak, highest_pot FROM players WHERE id = $1 FOR UPDATE`,
        [playerId],
      );
      const player = current.rows[0];
      if (!player) continue;
      const progress = applyXp(player.level, player.xp, gained);
      const highestPot = won && match.kind === 'stake' ? Math.max(Number(player.highest_pot), pot) : Number(player.highest_pot);
      if (counts) {
        await client.query(
          `UPDATE players SET level = $1, xp = $2, wins = wins + $3, losses = losses + $4,
             win_streak = CASE WHEN $3 = 1 THEN win_streak + 1 ELSE 0 END,
             highest_pot = $5,
             weekly_wins = CASE WHEN $3 = 1 THEN (CASE WHEN week_start = $6::date THEN weekly_wins + 1 ELSE 1 END) ELSE (CASE WHEN week_start = $6::date THEN weekly_wins ELSE 0 END) END,
             week_start = $6::date,
             last_win_at = CASE WHEN $3 = 1 THEN now() ELSE last_win_at END
           WHERE id = $7`,
          [progress.level, progress.xp, won ? 1 : 0, won ? 0 : 1, highestPot, weekStart(), playerId],
        );
      } else {
        await client.query(`UPDATE players SET level = $1, xp = $2 WHERE id = $3`, [progress.level, progress.xp, playerId]);
      }
      for (let index = 0; index < progress.levelUps.length; index += 1) {
        await credit(client, playerId, 'cash', 5, 'level_reward', match.id);
      }
      const after = await client.query<{ coins: string }>(`SELECT coins FROM players WHERE id = $1`, [playerId]);
      perSeat[String(seat)] = { xp: gained, levelUps: progress.levelUps, coins: Number(after.rows[0]?.coins ?? 0) };
    }

    await client.query(
      `UPDATE matches SET status = $1, winner_seat = $2, result_case = $3, settled_at = now(), settlement = $4 WHERE id = $5`,
      [resultCase === 'forfeit' ? 'forfeited' : 'settled', winnerSeat, resultCase, JSON.stringify(perSeat), match.id],
    );
    return perSeat;
  });
  if (!settlement) return;
  match.status = resultCase === 'forfeit' ? 'forfeited' : 'settled';
  match.winner_seat = winnerSeat;
  match.result_case = resultCase;
  match.settlement = settlement;
  const room = rooms.get(match.id);
  if (room) room.shotDeadline = null;
  for (const playerId of [match.seat1, match.seat2]) {
    if (playerId) publishPlayer(playerId);
  }
}

export async function voidMatch(match: MatchRow): Promise<void> {
  const entry = Number(match.entry);
  const done = await transaction(async (client) => {
    const locked = await client.query<MatchRow>(`SELECT * FROM matches WHERE id = $1 FOR UPDATE`, [match.id]);
    const row = locked.rows[0];
    if (!row || (row.status !== 'in_play' && row.status !== 'waiting')) return false;
    if (match.kind === 'stake' && entry > 0) {
      for (const playerId of [row.seat1, row.seat2]) {
        if (playerId) await fromEscrow(client, playerId, entry, 'match_refund', match.id);
      }
    }
    await client.query(`UPDATE matches SET status = 'voided', result_case = 'void', settled_at = now(), settlement = '{}'::jsonb WHERE id = $1`, [match.id]);
    return true;
  });
  if (!done) return;
  match.status = 'voided';
  match.result_case = 'void';
  match.settlement = {};
  const room = rooms.get(match.id);
  if (room) room.shotDeadline = null;
  for (const playerId of [match.seat1, match.seat2]) {
    if (playerId) publishPlayer(playerId);
  }
  await publishTable(match.id);
}

async function expireShotClock(match: MatchRow): Promise<void> {
  const names = await namesOf(match);
  const room = roomOf(match, names);
  const seat = match.state.activeSeat;
  const ruling = applyShot({
    state: match.state,
    seat,
    outcome: { firstContact: null, pocketed: [], cushion: false, scratch: false, offTable: [] },
    calledPocket: null,
    names,
    positions: match.state.positions,
    clockExpired: true,
  });
  match.state = ruling.state;
  room.announcements.push(...ruling.announcements);
  room.banner = ruling.banner;
  room.timedOutTurns[seat] += 1;
  room.expiredSeat = seat;
  await saveState(match);
  if (room.timedOutTurns[seat] >= 3) {
    await settleMatch(match, otherSeat(seat), 'forfeit');
  } else {
    room.shotDeadline = Date.now() + shotClockFor(match, ruling.state.activeSeat) * 1000;
  }
  await publishTable(match.id);
}

export function clockExpired(match: MatchRow): boolean {
  const room = rooms.get(match.id);
  if (!room || room.shotDeadline === null) return false;
  return Date.now() > room.shotDeadline;
}

export async function handleExpiredClock(match: MatchRow): Promise<void> {
  if (match.status !== 'in_play') return;
  await expireShotClock(match);
}

/** One server tick: clocks, drops, forfeits and voids, then a push so every clock is the server's. */
export async function tick(): Promise<void> {
  const live = await query<MatchRow>(`SELECT * FROM matches WHERE status IN ('in_play','waiting')`).catch(() => []);
  for (const match of live) {
    const names = await namesOf(match).catch(() => ({ 1: 'Player 1', 2: 'Player 2' } as Record<Seat, string>));
    const room = roomOf(match, names);
    const viewers = tableViewers(match.id);
    const now = Date.now();
    for (const seat of [1, 2] as Seat[]) {
      const playerId = seat === 1 ? match.seat1 : match.seat2;
      if (!playerId) continue;
      const present = viewers.some((client) => client.playerId === playerId);
      if (present) {
        room.seatSeen[seat] = now;
        room.droppedSince[seat] = null;
      } else if (room.seatSeen[seat] > 0 && now - room.seatSeen[seat] > 5000 && room.droppedSince[seat] === null) {
        room.droppedSince[seat] = now;
      }
    }
    if (match.status === 'in_play') {
      const bothDropped = room.droppedSince[1] !== null && room.droppedSince[2] !== null;
      if (bothDropped) {
        const graceMs = config.reconnectGraceSeconds * 1000;
        const out1 = now - (room.droppedSince[1] as number) > graceMs;
        const out2 = now - (room.droppedSince[2] as number) > graceMs;
        if (out1 && out2) {
          await voidMatch(match);
          continue;
        }
      }
      if (room.shotDeadline !== null && now > room.shotDeadline) {
        await expireShotClock(match);
        continue;
      }
    }
    if (viewers.length > 0) await publishTable(match.id);
  }
}

export async function escrowEntries(client: Queryable, matchId: string, playerIds: string[], entry: number, kind: 'match_entry' | 'tournament_entry'): Promise<void> {
  for (const playerId of playerIds) {
    await toEscrow(client, playerId, entry, kind, matchId);
  }
}

export function pocketFromApi(value: unknown): Pocket | null {
  const pockets: Pocket[] = ['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right'];
  return pockets.find((pocket) => pocket === value) ?? null;
}

export async function playerHasLiveMatch(playerId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM matches WHERE (seat1 = $1 OR seat2 = $1) AND status IN ('in_play','waiting') LIMIT 1`,
    [playerId],
  );
  return Boolean(row);
}

