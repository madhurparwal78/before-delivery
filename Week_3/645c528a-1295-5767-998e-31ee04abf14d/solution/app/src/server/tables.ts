/** Live rooms: one server-held table per match. Shot results, turns, clocks and settlement are all decided here and in rules.ts. */
import { randomUUID } from 'node:crypto';
import { formatNumber, gainXp, matchXp, POCKETS, TIERS, type Mode, type Pocket } from '../shared/domain';
import {
  BALL_RADIUS, CUE_BALL, HEAD_SPOT, TABLE_LENGTH, TABLE_WIDTH, cueSpotFrom, cutTowards, overlapsBall, rackSpots, respotted, simulate,
  type BallSpots, type Point,
} from '../shared/physics';
import {
  adjudicate, adjudicateClockExpiry, ballsLeft, bannerSentence, calledPocketRequired, otherSeat, placementAllowed, resultLine, shotLines, turnText,
  BEHIND_HEAD_STRING, CALL_POCKET, VOID_LINE,
  type Rack, type Ruling, type Seat, type SeatNames, type ShotOutcome, type Win,
} from '../shared/rules';
import type { Session } from './auth';
import { playerById } from './auth';
import { config } from './config';
import { query, transaction, type Db } from './db';
import { ApiError, assertUuid, notFound, validationFailed } from './errors';
import { route, type Json } from './http';
import { ESCROW, HOUSE, SYSTEM, balance, lineBody, lockPlayer, wallet, writePair, type LedgerRow } from './ledger';
import { notifyPlayer, sendTo, watchersOf, type LiveClient } from './realtime';
import { isQueued } from './queue-tickets';
import { equippedCueStats, type CueStats } from './shop';

const DROP_DETECT_MS = 2000;
const FORFEIT_AFTER_TIMEOUTS = 3;
const LEVEL_REWARD_CASH = 5;
const SECOND_DEVICE = "You're in a match on another device";
const NOT_SEATED = 'This table is private to its players.';
const TOO_LATE = 'Too late. The shot clock ran out.';
export const NOT_ENOUGH_COINS = 'Not enough Coins for this table.';

type TableKind = 'stake' | 'private' | 'tournament';
type RoomStatus = 'waiting' | 'in_play' | 'settled' | 'forfeited' | 'voided' | 'expired';

interface RoomSeat {
  playerId: string;
  displayName: string;
  sessionId: string | null;
  connections: number;
  connected: boolean;
  dropCheckAt: number | null;
  graceEndsAt: number | null;
  timeouts: number;
  stats: CueStats;
  cloth: string;
  aimBonus: number;
}

interface SeatResult {
  line: string;
  coinChange: string;
  xpGained: number;
  levelUps: string[];
  coins: number;
}

interface ShotReceipt {
  firstBall: number | null;
  cut: number;
}

export interface Room {
  id: string;
  kind: TableKind;
  mode: Mode;
  tier: number;
  pot: number;
  status: RoomStatus;
  rack: Rack;
  seats: RoomSeat[];
  spots: BallSpots;
  script: ShotOutcome[] | null;
  banner: string;
  win: Win | null;
  results: Partial<Record<Seat, SeatResult>>;
  logs: Record<Seat, string[]>;
  receipt: ShotReceipt | null;
  shotCount: number;
  clockEndsAt: number | null;
  expiredSeat: Seat | null;
  rematchAsks: string[];
  rematchUrl: string | null;
  inviteUrl: string | null;
  inviteEndsAt: number | null;
  tournamentId: string | null;
}

const rooms = new Map<string, Room>();
const liveRoomOf = new Map<string, string>();
const roomQueues = new Map<string, Promise<unknown>>();
type MatchEndHandler = (room: Room, tournamentId: string) => Promise<void>;
let onTournamentMatchEnd: MatchEndHandler = async () => undefined;

export function setTournamentMatchEnd(handler: MatchEndHandler): void {
  onTournamentMatchEnd = handler;
}

function isLive(room: Room): boolean {
  return room.status === 'in_play' || room.status === 'waiting';
}

export function activeTableUrl(playerId: string): string | null {
  const id = liveRoomOf.get(playerId);
  return id === undefined ? null : `/table/${id}`;
}

export function inLiveMatch(playerId: string): boolean {
  return liveRoomOf.has(playerId);
}

function namesOf(room: Room): SeatNames {
  return { 1: room.seats[0].displayName, 2: room.seats[1]?.displayName ?? '' };
}

function seatNumberOf(room: Room, playerId: string): Seat | null {
  const index = room.seats.findIndex((seat) => seat.playerId === playerId);
  return index === -1 ? null : ((index + 1) as Seat);
}

function seatOf(room: Room, seat: Seat): RoomSeat {
  return room.seats[seat - 1];
}

function startTurnClock(room: Room): void {
  const shooter = seatOf(room, room.rack.activeSeat);
  room.clockEndsAt = Date.now() + config.shotClockMs + shooter.stats.time * 1000;
}

function freshRack(mode: Mode): Rack {
  const nine = mode === 'nine-ball';
  return {
    mode,
    phase: nine ? 'open' : 'break',
    groups: { 1: null, 2: null },
    balls: Array.from({ length: nine ? 9 : 15 }, (_, index) => index + 1),
    activeSeat: 1,
    ballInHand: false,
    behindHeadString: false,
  };
}

export async function seatFor(client: Db, playerId: string, sessionId: string | null): Promise<RoomSeat> {
  const player = await playerById(client, playerId);
  const stats = await equippedCueStats(client, playerId);
  return {
    playerId,
    displayName: player.display_name,
    sessionId,
    connections: 0,
    connected: true,
    dropCheckAt: null,
    graceEndsAt: null,
    timeouts: 0,
    stats,
    cloth: player.equipped_cloth_id,
    aimBonus: stats.aim,
  };
}

interface RoomPlan {
  kind: TableKind;
  mode: Mode;
  tier: number;
  seats: RoomSeat[];
  rack?: Rack;
  script?: ShotOutcome[];
  tournamentId?: string;
}

function openingBanner(rack: Rack): string {
  return calledPocketRequired(rack) ? CALL_POCKET : '';
}

/** Moves both entries to escrow and opens the room; the caller's transaction makes the two one step. */
export async function openRoom(client: Db, plan: RoomPlan): Promise<Room> {
  const id = randomUUID();
  const tier = TIERS[plan.tier - 1];
  const rack = plan.rack ?? freshRack(plan.mode);
  if (plan.kind === 'stake') await escrowEntries(client, plan.seats.map((seat) => seat.playerId), tier.entry, id);
  const opening = openingBanner(rack);
  const room: Room = {
    id,
    kind: plan.kind,
    mode: plan.mode,
    tier: plan.tier,
    pot: plan.kind === 'stake' ? tier.pot : 0,
    status: plan.seats.length === 2 ? 'in_play' : 'waiting',
    rack,
    seats: plan.seats,
    spots: rackSpots(rack.balls),
    script: plan.script ?? null,
    banner: opening,
    win: null,
    results: {},
    logs: { 1: opening ? [opening] : [], 2: opening ? [opening] : [] },
    receipt: null,
    shotCount: 0,
    clockEndsAt: null,
    expiredSeat: null,
    rematchAsks: [],
    rematchUrl: null,
    inviteUrl: null,
    inviteEndsAt: null,
    tournamentId: plan.tournamentId ?? null,
  };
  if (room.status === 'in_play') startTurnClock(room);
  await client.query(
    `INSERT INTO matches (id, kind, mode, tier, status, seat_one, seat_two, tournament_id, room) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, room.kind, room.mode, room.tier, room.status, room.seats[0].playerId, room.seats[1]?.playerId ?? null, room.tournamentId, room],
  );
  rooms.set(id, room);
  for (const seat of room.seats) liveRoomOf.set(seat.playerId, id);
  return room;
}

async function escrowEntries(client: Db, players: string[], entry: number, matchId: string): Promise<void> {
  for (const playerId of [...players].sort()) await lockPlayer(client, playerId);
  for (const playerId of players) {
    if ((await balance(client, playerId, 'coins')) < entry) throw new ApiError(409, 'insufficient_coins', NOT_ENOUGH_COINS);
  }
  for (const playerId of players) {
    await writePair(client, { from: wallet(playerId), to: ESCROW, amount: entry, currency: 'coins', kind: 'match_entry', refId: matchId });
  }
}

async function loadRoom(id: string): Promise<Room> {
  assertUuid(id);
  const cached = rooms.get(id);
  if (cached !== undefined) return cached;
  const rows = await query<{ room: Room }>('SELECT room FROM matches WHERE id = $1', [id]);
  if (rows.length === 0) throw notFound();
  const { room } = rows[0];
  for (const seat of room.seats) {
    seat.connections = 0;
    if (isLive(room)) liveRoomOf.set(seat.playerId, room.id);
  }
  rooms.set(id, room);
  return room;
}

/** One action at a time per room, so a clock expiry and a shot can never both win. */
async function withRoom<T>(id: string, work: (room: Room) => Promise<T>): Promise<T> {
  const room = await loadRoom(id);
  const previous = roomQueues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => work(room));
  roomQueues.set(id, next.catch(() => undefined));
  return next;
}

async function persist(room: Room): Promise<void> {
  await query('UPDATE matches SET status = $2, seat_two = $3, room = $4 WHERE id = $1', [room.id, room.status, room.seats[1]?.playerId ?? null, room]);
}

function claimSeat(room: Room, session: Session): { seat: Seat; seatedHere: boolean } | null {
  const seat = seatNumberOf(room, session.playerId);
  if (seat === null) return null;
  const held = seatOf(room, seat);
  if (held.sessionId === null || !held.connected) held.sessionId = session.id;
  return { seat, seatedHere: held.sessionId === session.id };
}

function secondsLeft(until: number | null): number | null {
  return until === null ? null : Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function reconnectSeconds(room: Room): number | null {
  const left = room.seats.map((seat) => secondsLeft(seat.graceEndsAt) ?? 0);
  const longest = Math.max(...left);
  return isLive(room) && longest > 0 ? longest : null;
}

function bannerFor(room: Room, viewer: Seat | null): string {
  return (viewer === null ? undefined : room.results[viewer]?.line) ?? room.banner;
}

function tableBody(room: Room, playerId: string, seatedHere: boolean): Json {
  const viewer = seatNumberOf(room, playerId);
  return {
    id: room.id,
    mode: room.mode,
    tier: room.tier,
    status: room.status,
    seats: room.seats.map((seat, index) => ({
      seat: index + 1,
      playerId: seat.playerId,
      displayName: seat.displayName,
      group: room.rack.groups[(index + 1) as Seat],
      ballsLeft: ballsLeft(room.rack, (index + 1) as Seat),
      connected: seat.connected,
    })),
    activeSeat: room.rack.activeSeat,
    ballInHand: room.rack.ballInHand,
    calledPocketRequired: calledPocketRequired(room.rack),
    shotClockSeconds: room.status === 'in_play' ? secondsLeft(room.clockEndsAt) : null,
    reconnectSeconds: reconnectSeconds(room),
    pot: room.pot,
    seatedHere,
    ruleBanner: bannerFor(room, viewer),
    balls: room.rack.balls,
    result: viewer === null ? null : room.results[viewer] ?? null,
  };
}

interface Replay {
  frames: BallSpots[] | null;
}

function liveView(room: Room, client: LiveClient, replay: Replay | null): Json {
  const viewer = seatNumberOf(room, client.session.playerId) as Seat;
  const seatedHere = seatOf(room, viewer).sessionId === client.session.id;
  return {
    body: tableBody(room, client.session.playerId, seatedHere),
    kind: room.kind,
    turn: seatedHere ? turnText(room.rack, viewer, namesOf(room), !isLive(room)) : '',
    spots: room.spots,
    log: seatedHere ? room.logs[viewer] : [],
    receipt: room.receipt,
    frames: replay?.frames ?? null,
    behindHeadString: room.rack.behindHeadString,
    aimBonus: seatOf(room, viewer).aimBonus,
    cloth: seatOf(room, viewer).cloth,
    groups: room.rack.groups,
    rematchUrl: room.rematchUrl,
    rematchAsked: room.rematchAsks.includes(client.session.playerId),
    inviteUrl: viewer === 1 && room.status === 'waiting' ? room.inviteUrl : null,
  };
}

function broadcast(room: Room, replay: Replay | null = null): void {
  const topic = `table:${room.id}`;
  for (const client of watchersOf(topic)) {
    if (seatNumberOf(room, client.session.playerId) !== null) sendTo(client, { topic, ...liveView(room, client, replay) });
  }
}

function appendTurnLines(room: Room, ruling: Ruling, turnChanged: boolean): void {
  const names = namesOf(room);
  const shared = shotLines(ruling, names);
  for (const seat of [1, 2] as Seat[]) {
    room.logs[seat].push(...shared);
    if (ruling.win === null && turnChanged) room.logs[seat].push(turnText(room.rack, seat, names, false));
  }
}

function placeRespottedBalls(room: Room): void {
  const { balls } = room.rack;
  for (const key of Object.keys(room.spots)) {
    const ball = Number(key);
    if (ball !== CUE_BALL && !balls.includes(ball)) delete room.spots[ball];
  }
  for (const ball of balls) if (room.spots[ball] === undefined) room.spots[ball] = respotted(room.spots, ball);
  if (room.spots[CUE_BALL] === undefined || room.rack.ballInHand) room.spots[CUE_BALL] = cueSpotFrom(room.spots, HEAD_SPOT);
}

function applyRuling(room: Room, ruling: Ruling): void {
  const turnChanged = ruling.next.activeSeat !== room.rack.activeSeat;
  room.rack = ruling.next;
  room.banner = bannerSentence(ruling);
  placeRespottedBalls(room);
  appendTurnLines(room, ruling, turnChanged);
}

async function creditLevels(client: Db, playerId: string, gained: number[], matchId: string): Promise<string[]> {
  for (let index = 0; index < gained.length; index += 1) {
    await writePair(client, { from: SYSTEM, to: wallet(playerId), amount: LEVEL_REWARD_CASH, currency: 'cash', kind: 'level_reward', refId: matchId });
  }
  return gained.map((level) => `Level ${level} reached: +${LEVEL_REWARD_CASH} Cash`);
}

async function recordPlayer(client: Db, room: Room, seat: Seat, won: boolean): Promise<{ xpGained: number; levelUps: string[] }> {
  const playerId = seatOf(room, seat).playerId;
  await lockPlayer(client, playerId);
  if (room.kind === 'private') return { xpGained: 0, levelUps: [] };
  const player = await playerById(client, playerId);
  const xpGained = matchXp(room.tier, won);
  const { level, xp, levelsReached } = gainXp(player.level, player.xp, xpGained);
  await client.query(
    `UPDATE players SET level = $2, xp = $3, wins = wins + $4, losses = losses + $5,
       win_streak = CASE WHEN $4 = 1 THEN win_streak + 1 ELSE 0 END, highest_pot = GREATEST(highest_pot, $6) WHERE id = $1`,
    [playerId, level, xp, won ? 1 : 0, won ? 0 : 1, won ? room.pot : 0],
  );
  if (won && room.kind === 'stake') {
    await client.query(
      `INSERT INTO weekly_wins (player_id, week_start, wins, last_win_at)
       VALUES ($1, date_trunc('week', now() AT TIME ZONE 'UTC')::date, 1, now())
       ON CONFLICT (player_id, week_start) DO UPDATE SET wins = weekly_wins.wins + 1, last_win_at = now()`,
      [playerId],
    );
  }
  return { xpGained, levelUps: await creditLevels(client, playerId, levelsReached, room.id) };
}

function coinChange(room: Room, won: boolean): string {
  if (room.kind !== 'stake') return 'No Coins at stake';
  return won ? `Pot won: ${formatNumber(room.pot)} Coins` : `Entry lost: ${formatNumber(TIERS[room.tier - 1].entry)} Coins`;
}

/** Another instance on this database ended the match first, so this copy of the room is stale. */
function forgetRoom(room: Room): void {
  rooms.delete(room.id);
  for (const { playerId } of room.seats) if (liveRoomOf.get(playerId) === room.id) liveRoomOf.delete(playerId);
}

/** Settlement: Coins, XP, level, record and ledger move in one transaction, and the conditional update ends the escrow exactly once. */
async function settle(room: Room, win: Win): Promise<void> {
  const status = win.reason === 'forfeit' ? 'forfeited' : 'settled';
  const names = namesOf(room);
  const results = await transaction(async (client) => {
    const { rowCount } = await client.query(`UPDATE matches SET status = $2, ended_at = now() WHERE id = $1 AND status = 'in_play'`, [room.id, status]);
    if (rowCount !== 1) return null;
    if (room.kind === 'stake') {
      const entry = TIERS[room.tier - 1].entry;
      const winnerId = seatOf(room, win.seat).playerId;
      await lockPlayer(client, winnerId);
      await writePair(client, { from: ESCROW, to: wallet(winnerId), amount: room.pot, currency: 'coins', kind: 'match_win', refId: room.id });
      await writePair(client, { from: ESCROW, to: HOUSE, amount: entry * 2 - room.pot, currency: 'coins', kind: 'house_cut', refId: room.id });
    }
    const seatResult = async (seat: Seat): Promise<SeatResult> => {
      const won = seat === win.seat;
      const { xpGained, levelUps } = await recordPlayer(client, room, seat, won);
      return {
        line: resultLine(win, seat, names),
        coinChange: coinChange(room, won),
        xpGained,
        levelUps,
        coins: await balance(client, seatOf(room, seat).playerId, 'coins'),
      };
    };
    return { 1: await seatResult(1), 2: await seatResult(2) };
  });
  if (results === null) {
    forgetRoom(room);
    return;
  }
  room.status = status;
  room.win = win;
  await afterMatch(room, results);
}

async function voidMatch(room: Room): Promise<void> {
  const results = await transaction(async (client) => {
    const { rowCount } = await client.query(`UPDATE matches SET status = 'voided', ended_at = now() WHERE id = $1 AND status = 'in_play'`, [room.id]);
    if (rowCount !== 1) return null;
    const entry = TIERS[room.tier - 1].entry;
    const seatResult = async (seat: Seat): Promise<SeatResult> => {
      const playerId = seatOf(room, seat).playerId;
      await lockPlayer(client, playerId);
      if (room.kind === 'stake') {
        await writePair(client, { from: ESCROW, to: wallet(playerId), amount: entry, currency: 'coins', kind: 'match_refund', refId: room.id });
      }
      return {
        line: VOID_LINE,
        coinChange: room.kind === 'stake' ? `Entry returned: ${formatNumber(entry)} Coins` : 'No Coins at stake',
        xpGained: 0,
        levelUps: [],
        coins: await balance(client, playerId, 'coins'),
      };
    };
    return { 1: await seatResult(1), 2: await seatResult(2) };
  });
  if (results === null) {
    forgetRoom(room);
    return;
  }
  room.status = 'voided';
  await afterMatch(room, results);
}

async function afterMatch(room: Room, results: Record<Seat, SeatResult>): Promise<void> {
  room.clockEndsAt = null;
  room.results = results;
  for (const seat of [1, 2] as Seat[]) {
    const held = seatOf(room, seat);
    room.logs[seat].push('Game over', results[seat].line);
    if (liveRoomOf.get(held.playerId) === room.id) liveRoomOf.delete(held.playerId);
    notifyPlayer(held.playerId);
  }
  await persist(room);
  if (room.tournamentId !== null) await onTournamentMatchEnd(room, room.tournamentId);
}

function pocketOf(value: unknown): Pocket | null {
  return POCKETS.includes(value as Pocket) ? (value as Pocket) : null;
}

const SHOT_FIELDS = ['aimDegrees', 'power', 'sideSpin', 'topSpin', 'calledPocket'];

function inRange(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
}

function shotErrors(body: Json): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) if (!SHOT_FIELDS.includes(key)) errors[key] = 'Not accepted.';
  if (!inRange(body.aimDegrees, 0, 360)) errors.aimDegrees = 'Use 0 to 360.';
  if (!inRange(body.power, 0.1, 100)) errors.power = 'Use 1 to 100.';
  if (!inRange(body.sideSpin, -100, 100)) errors.sideSpin = 'Use -100 to 100.';
  if (!inRange(body.topSpin, -100, 100)) errors.topSpin = 'Use -100 to 100.';
  if (body.calledPocket !== null && body.calledPocket !== undefined && pocketOf(body.calledPocket) === null) errors.calledPocket = 'Name a pocket.';
  return errors;
}

function runShot(room: Room, scripted: ShotOutcome | undefined, aimDegrees: number, power: number, sideSpin: number, topSpin: number, shooter: RoomSeat): { outcome: ShotOutcome; frames: BallSpots[] | null; cut: number } {
  if (scripted !== undefined) {
    const outcome = scripted;
    const cut = outcome.firstContact === null ? 0 : cutTowards(room.spots, outcome.firstContact, aimDegrees);
    for (const { ball } of outcome.pocketed) delete room.spots[ball];
    return { outcome, frames: null, cut };
  }
  const shot = simulate(room.spots, { aimDegrees, power, sideSpin, topSpin, powerBonus: shooter.stats.power, spinBonus: shooter.stats.spin }, room.rack.phase === 'break');
  room.spots = { ...shot.rest };
  return { outcome: shot.outcome, frames: shot.frames, cut: shot.firstCut };
}

function refuseFinished(room: Room): void {
  if (room.status !== 'in_play') throw new ApiError(409, 'match_over', 'This match is over.');
}

function refuseOutOfTurn(room: Room, seat: Seat): void {
  if (room.expiredSeat === seat) throw new ApiError(409, 'shot_clock_expired', TOO_LATE);
  if (room.rack.activeSeat !== seat) throw new ApiError(409, 'not_your_turn', 'It is not your turn.');
}

function seatedPlayer(room: Room, session: Session): Seat {
  const claim = claimSeat(room, session);
  if (claim === null) throw new ApiError(403, 'not_seated', NOT_SEATED);
  if (!claim.seatedHere) throw new ApiError(409, 'other_device', SECOND_DEVICE);
  return claim.seat;
}

async function takeShot(room: Room, session: Session, body: Json): Promise<Json> {
  const seat = seatedPlayer(room, session);
  await runDueClock(room);
  refuseFinished(room);
  refuseOutOfTurn(room, seat);
  const required = calledPocketRequired(room.rack);
  if (required && (body.calledPocket === null || body.calledPocket === undefined)) throw new ApiError(409, 'called_pocket_required', CALL_POCKET);
  const errors = shotErrors(body);
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  const scripted = room.script?.shift();
  if (room.script !== null && scripted === undefined) throw new ApiError(409, 'script_exhausted', 'The script has no shot left.');

  const shooter = seatOf(room, seat);
  shooter.timeouts = 0;
  room.expiredSeat = null;
  const { aimDegrees, power, sideSpin, topSpin } = body as { aimDegrees: number; power: number; sideSpin: number; topSpin: number };
  const calledPocket = pocketOf(body.calledPocket);
  const { outcome, frames, cut } = runShot(room, scripted, aimDegrees, power, sideSpin, topSpin, shooter);
  room.shotCount += 1;
  room.receipt = { firstBall: outcome.firstContact, cut };
  await query(
    `INSERT INTO shots (match_id, number, seat, aim_degrees, power, side_spin, top_spin, called_pocket, outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [room.id, room.shotCount, seat, aimDegrees, power, sideSpin, topSpin, calledPocket, outcome],
  );
  const ruling = adjudicate(room.rack, outcome, calledPocket, namesOf(room));
  applyRuling(room, ruling);
  if (ruling.win !== null) await settle(room, ruling.win);
  else {
    startTurnClock(room);
    await persist(room);
  }
  broadcast(room, { frames });
  return tableBody(room, session.playerId, true);
}

function cueBallPoint(body: Json): Point | null {
  if (!inRange(body.across, 0, 100) || !inRange(body.along, 0, 100)) return null;
  const clamp = (value: number, high: number): number => Math.min(high - BALL_RADIUS, Math.max(BALL_RADIUS, value));
  return [clamp(body.across, TABLE_WIDTH), clamp(body.along * 2, TABLE_LENGTH)];
}

async function placeBall(room: Room, session: Session, body: Json): Promise<Json> {
  const seat = seatedPlayer(room, session);
  await runDueClock(room);
  refuseFinished(room);
  refuseOutOfTurn(room, seat);
  if (!room.rack.ballInHand) throw new ApiError(409, 'no_ball_in_hand', 'You do not have ball in hand.');
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) if (key !== 'across' && key !== 'along') errors[key] = 'Not accepted.';
  const point = cueBallPoint(body);
  if (point === null) {
    if (!inRange(body.across, 0, 100)) errors.across = 'Use 0 to 100.';
    if (!inRange(body.along, 0, 100)) errors.along = 'Use 0 to 100.';
  } else if (overlapsBall(room.spots, point)) {
    throw new ApiError(409, 'cue_ball_overlap', 'That spot is taken by another ball.');
  }
  if (inRange(body.along, 0, 100) && !placementAllowed(room.rack, body.along)) errors.along = BEHIND_HEAD_STRING;
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  room.spots[CUE_BALL] = point as Point;
  room.rack = { ...room.rack, ballInHand: false, behindHeadString: false };
  await persist(room);
  broadcast(room);
  return tableBody(room, session.playerId, true);
}

async function expireClock(room: Room): Promise<void> {
  const seat = room.rack.activeSeat;
  const held = seatOf(room, seat);
  held.timeouts += 1;
  room.expiredSeat = seat;
  const ruling = adjudicateClockExpiry(room.rack);
  applyRuling(room, ruling);
  if (held.timeouts >= FORFEIT_AFTER_TIMEOUTS) await settle(room, { seat: otherSeat(seat), reason: 'forfeit' });
  else {
    startTurnClock(room);
    await persist(room);
  }
  broadcast(room);
}

async function runDueClock(room: Room): Promise<void> {
  if (room.status === 'in_play' && room.clockEndsAt !== null && Date.now() >= room.clockEndsAt) await expireClock(room);
}

function markDropped(room: Room): void {
  const now = Date.now();
  for (const seat of room.seats) {
    if (seat.dropCheckAt !== null && now >= seat.dropCheckAt) {
      seat.dropCheckAt = null;
      seat.connected = false;
      seat.graceEndsAt = now + config.reconnectGraceMs;
    }
    if (seat.graceEndsAt !== null && now >= seat.graceEndsAt) seat.graceEndsAt = null;
  }
}

function bothGracesOver(room: Room): boolean {
  return room.seats.length === 2 && room.seats.every((seat) => !seat.connected && seat.graceEndsAt === null);
}

async function expireInvite(room: Room): Promise<void> {
  room.status = 'expired';
  await persist(room);
  await query(`UPDATE matches SET ended_at = now() WHERE id = $1`, [room.id]);
  liveRoomOf.delete(room.seats[0].playerId);
  notifyPlayer(room.seats[0].playerId);
  broadcast(room);
}

/** The server's clock: one pass over every live room, at least once a second. */
export function tickRooms(): void {
  for (const room of rooms.values()) {
    if (!isLive(room)) {
      if (watchersOf(`table:${room.id}`).length === 0) {
        rooms.delete(room.id);
        roomQueues.delete(room.id);
      }
      continue;
    }
    void withRoom(room.id, async (current) => {
      if (current.status === 'waiting') {
        if (current.inviteEndsAt !== null && Date.now() >= current.inviteEndsAt) await expireInvite(current);
        return;
      }
      if (current.status !== 'in_play') return;
      markDropped(current);
      if (bothGracesOver(current)) {
        await voidMatch(current);
        broadcast(current);
        return;
      }
      await runDueClock(current);
      broadcast(current);
    }).catch((error: unknown) => console.error(error));
  }
}

export function watchTable(client: LiveClient, id: string): void {
  void withRoom(id, async (room) => {
    const claim = claimSeat(room, client.session);
    if (claim === null || !client.topics.has(`table:${id}`)) return;
    if (claim.seatedHere) {
      const seat = seatOf(room, claim.seat);
      seat.connections += 1;
      seat.dropCheckAt = null;
      seat.graceEndsAt = null;
      seat.connected = true;
      broadcast(room);
    } else {
      sendTo(client, { topic: `table:${id}`, ...liveView(room, client, null) });
    }
  }).catch(() => undefined);
}

export function unwatchTable(client: LiveClient, id: string): void {
  const room = rooms.get(id);
  if (room === undefined) return;
  const seat = seatNumberOf(room, client.session.playerId);
  if (seat === null) return;
  const held = seatOf(room, seat);
  if (held.sessionId !== client.session.id) return;
  held.connections = Math.max(0, held.connections - 1);
  if (held.connections === 0 && room.status === 'in_play') held.dropCheckAt = Date.now() + DROP_DETECT_MS;
}

async function rematch(room: Room, session: Session): Promise<{ status: number; body: Json }> {
  const seat = seatNumberOf(room, session.playerId);
  if (seat === null) throw new ApiError(403, 'not_seated', NOT_SEATED);
  if (isLive(room) || room.kind === 'tournament') throw new ApiError(409, 'match_not_over', 'This match has no rematch yet.');
  if (room.rematchUrl !== null) return { status: 201, body: { tableUrl: room.rematchUrl } };
  const entry = room.kind === 'stake' ? TIERS[room.tier - 1].entry : 0;
  const coins = await transaction((client) => balance(client, session.playerId, 'coins'));
  if (coins < entry) throw new ApiError(409, 'insufficient_coins', 'Not enough Coins for a rematch.');
  if (!room.rematchAsks.includes(session.playerId)) room.rematchAsks.push(session.playerId);
  if (room.rematchAsks.length < 2) {
    await persist(room);
    broadcast(room);
    return { status: 202, body: { status: 'waiting' } };
  }
  const next = await transaction(async (client) => {
    const seats = [];
    for (const held of room.seats) seats.push(await seatFor(client, held.playerId, held.sessionId));
    return openRoom(client, { kind: room.kind, mode: room.mode, tier: room.tier, seats });
  });
  room.rematchUrl = `/table/${next.id}`;
  await persist(room);
  for (const held of room.seats) notifyPlayer(held.playerId);
  broadcast(room);
  return { status: 201, body: { tableUrl: room.rematchUrl } };
}

export function registerTableRoutes(): void {
  route('GET', '/api/tables/{id}', async ({ session, params }) => {
    return withRoom(params.id, async (room) => {
      const claim = claimSeat(room, session);
      if (claim === null) throw new ApiError(403, 'not_seated', NOT_SEATED);
      await persist(room);
      return { status: 200, body: tableBody(room, session.playerId, claim.seatedHere) };
    });
  });

  route('POST', '/api/tables/{id}/shots', async ({ session, params, body }) => {
    return { status: 200, body: await withRoom(params.id, (room) => takeShot(room, session, body)) };
  }, { body: true });

  route('POST', '/api/tables/{id}/place', async ({ session, params, body }) => {
    return { status: 200, body: await withRoom(params.id, (room) => placeBall(room, session, body)) };
  }, { body: true });

  route('POST', '/api/tables/{id}/rematch', async ({ session, params }) => {
    return withRoom(params.id, (room) => rematch(room, session));
  });

  route('GET', '/api/matches/{id}/ledger', async ({ session, params }) => {
    const room = await loadRoom(params.id);
    if (seatNumberOf(room, session.playerId) === null) throw new ApiError(403, 'not_seated', NOT_SEATED);
    const lines = await query<LedgerRow>('SELECT * FROM ledger_lines WHERE ref_id = $1 ORDER BY seq', [room.id]);
    return { status: 200, body: { lines: lines.map(lineBody) } };
  });
}

/** After a restart, live matches resume: their deadlines are in Postgres, so the clock carries on from the same moment. */
export async function restoreRooms(): Promise<void> {
  const rows = await query<{ id: string }>(`SELECT id FROM matches WHERE status IN ('in_play', 'waiting')`);
  for (const { id } of rows) await loadRoom(id);
}

/** Seat two arrives through an invite: the private table starts at that moment. */
export async function seatInvitee(id: string, session: Session): Promise<string> {
  return withRoom(id, async (room) => {
    const url = `/table/${room.id}`;
    if (seatNumberOf(room, session.playerId) !== null) return url;
    if (room.status !== 'waiting') throw new ApiError(409, 'table_full', 'This table is full.');
    if (inLiveMatch(session.playerId)) throw new ApiError(409, 'in_match', 'You are already in a match.');
    room.seats.push(await transaction((client) => seatFor(client, session.playerId, session.id)));
    room.status = 'in_play';
    liveRoomOf.set(session.playerId, room.id);
    startTurnClock(room);
    await persist(room);
    broadcast(room);
    return url;
  });
}

export async function setInvite(id: string, inviteUrl: string, endsAt: number): Promise<void> {
  await withRoom(id, async (room) => {
    room.inviteUrl = inviteUrl;
    room.inviteEndsAt = endsAt;
    await persist(room);
  });
}

export async function playerIsBusy(client: Db, playerId: string): Promise<boolean> {
  if (inLiveMatch(playerId)) return true;
  const { rows } = await client.query(
    `SELECT 1 FROM tournament_entrants e JOIN tournaments t ON t.id = e.tournament_id
     WHERE e.player_id = $1 AND t.status NOT IN ('paid', 'refunded') LIMIT 1`,
    [playerId],
  );
  return rows.length > 0 || isQueued(playerId);
}

