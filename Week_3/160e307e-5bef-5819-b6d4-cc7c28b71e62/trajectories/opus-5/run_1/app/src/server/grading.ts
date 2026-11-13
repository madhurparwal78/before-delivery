import { query } from './db.js';
import { notFound, unprocessable } from './errors.js';
import { env } from './env.js';
import { applyRuledEvents, createMatch, getMatch, matchJson } from './match.js';
import { createNamedPlayer, equippedFor, newSessionFor, playerById } from './players.js';
import { grant } from './ledger.js';
import { createRoom } from './rooms.js';
import { COIN_IDS, baselineY, offsetToBoardX, openingPieces, ownerSeat } from '../shared/geometry.js';
import { makeBody, simulate } from '../shared/physics.js';
import { STRIKER_SPEED_PER_POWER } from '../shared/geometry.js';
import type { Format, Mode, Piece, PieceId, Seat, ShotEvents } from '../shared/types.js';
import type { Ctx } from './http.js';
import { num, str } from './http.js';
import { START_RATING, START_RD, START_VOLATILITY } from '../shared/rating.js';

/** A wrong or missing key answers 404, so the routes do not exist to anyone else. */
export function requireGradingKey(ctx: Ctx): void {
  if (env.gradingKey === null) throw notFound();
  if (ctx.req.headers['x-grading-key'] !== env.gradingKey) throw notFound();
}

export async function gradingCreatePlayer(ctx: Ctx): Promise<Record<string, unknown>> {
  const name = str(ctx.body, 'name');
  const avatar = num(ctx.body, 'avatar');
  if (name === null || avatar === null) throw unprocessable('NAME_INVALID');
  const player = await createNamedPlayer({
    name,
    avatar,
    email: str(ctx.body, 'email')?.toLowerCase() ?? null,
    rating: num(ctx.body, 'rating') ?? START_RATING,
    rd: num(ctx.body, 'rd') ?? START_RD,
    volatility: num(ctx.body, 'volatility') ?? START_VOLATILITY,
    rankedGames: num(ctx.body, 'rankedGames') ?? 0,
  });
  const chalk = num(ctx.body, 'chalk') ?? 0;
  if (chalk !== 0) await grant(player.id, chalk, 'grant');
  return { id: player.id, name: player.name, sessionCookie: await newSessionFor(player.id) };
}

function piecesFromBody(value: unknown, whiteSeat: Seat): Piece[] {
  if (!Array.isArray(value)) return openingPieces();
  const listed = new Map<PieceId, Piece>();
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : null;
    if (id === null) continue;
    const pocketed = row.state === 'pocketed';
    listed.set(id, {
      id,
      x: pocketed ? null : Number(row.x ?? 0),
      y: pocketed ? null : Number(row.y ?? 0),
      state: pocketed ? 'pocketed' : 'board',
      pocketedBy:
        row.pocketedBy === 0 || row.pocketedBy === 1
          ? (row.pocketedBy as Seat)
          : pocketed
            ? (id === 'queen' ? 0 : ownerSeat(id, whiteSeat))
            : null,
    });
  }
  return ['queen', ...COIN_IDS].map((id) => {
    const given = listed.get(id);
    if (given !== undefined) return given;
    return { id, x: null, y: null, state: 'pocketed' as const, pocketedBy: id === 'queen' ? 0 : ownerSeat(id, whiteSeat) };
  });
}

export async function gradingCreateMatch(ctx: Ctx): Promise<Record<string, unknown>> {
  const mode = (str(ctx.body, 'mode') ?? 'casual') as Mode;
  const format = (str(ctx.body, 'format') ?? 'classic') as Format;
  const ids = ctx.body.players;
  if (!Array.isArray(ids) || ids.length !== 2) throw unprocessable('INVALID_INTENT');
  const seats = [];
  for (const id of ids) {
    const player = await playerById(String(id));
    if (player === null) throw notFound();
    seats.push({
      playerId: player.id,
      name: player.name,
      avatar: player.avatar,
      strikerSkin: (await equippedFor(player.id)).striker,
    });
  }
  const whiteSeat = (num(ctx.body, 'white') ?? 0) === 1 ? 1 : 0;
  const scoresBody = ctx.body.scores;
  const scores: [number, number] = Array.isArray(scoresBody)
    ? [Number(scoresBody[0] ?? 0), Number(scoresBody[1] ?? 0)]
    : [0, 0];
  const duesBody = ctx.body.dues;
  const dues: [number, number] = Array.isArray(duesBody)
    ? [Number(duesBody[0] ?? 0), Number(duesBody[1] ?? 0)]
    : [0, 0];
  const timeoutsBody = ctx.body.timeouts;
  const timeouts: [number, number] = Array.isArray(timeoutsBody)
    ? [Number(timeoutsBody[0] ?? 0), Number(timeoutsBody[1] ?? 0)]
    : [0, 0];
  const queenBody = ctx.body.queen as Record<string, unknown> | undefined;
  const queen =
    queenBody === undefined || queenBody === null
      ? { state: 'board' as const, seat: null }
      : {
          state: (queenBody.state as 'board' | 'pending' | 'covered') ?? 'board',
          seat: queenBody.seat === 0 || queenBody.seat === 1 ? (queenBody.seat as Seat) : null,
        };

  if (mode === 'private') {
    const host = await playerById(String(ids[0]));
    if (host === null) throw notFound();
    const room = await createRoom(host, format);
    const match = await getMatch(room.matchId);
    if (match === null) throw notFound();
    match.seats[1].playerId = seats[1].playerId;
    match.seats[1].name = seats[1].name;
    match.seats[1].avatar = seats[1].avatar;
    match.seats[1].strikerSkin = seats[1].strikerSkin;
    match.seats[0].ready = true;
    match.seats[1].ready = true;
    match.status = 'active';
    match.whiteSeat = whiteSeat;
    match.turn = (num(ctx.body, 'turn') ?? whiteSeat) === 1 ? 1 : 0;
    match.board = num(ctx.body, 'board') ?? 1;
    match.seats[0].score = scores[0];
    match.seats[1].score = scores[1];
    match.seats[0].dues = dues[0];
    match.seats[1].dues = dues[1];
    match.seats[0].timeouts = timeouts[0];
    match.seats[1].timeouts = timeouts[1];
    match.queen = queen;
    match.pieces = piecesFromBody(ctx.body.pieces, whiteSeat);
    match.breakAttempt = ctx.body.breakAttempt === undefined ? null : (num(ctx.body, 'breakAttempt') ?? null);
    await query(
      'insert into match_players (match_id, seat, player_id, name, opponent_name) values ($1, 1, $2, $3, $4) on conflict (match_id, seat) do nothing',
      [match.id, seats[1].playerId, seats[1].name, seats[0].name],
    );
    await query('update match_players set opponent_name = $2 where match_id = $1 and seat = 0', [
      match.id,
      seats[1].name,
    ]);
    await query('update matches set status = $2, state = $3 where id = $1', [
      match.id,
      match.status,
      JSON.stringify(match),
    ]);
    return { id: match.id, url: `/match/${match.id}`, code: room.code };
  }

  const match = await createMatch({
    mode,
    format,
    seats,
    whiteSeat,
    turn: (num(ctx.body, 'turn') ?? whiteSeat) === 1 ? 1 : 0,
    board: num(ctx.body, 'board') ?? 1,
    scores,
    dues,
    timeouts,
    queen,
    pieces: piecesFromBody(ctx.body.pieces, whiteSeat),
    breakAttempt: ctx.body.breakAttempt === undefined ? null : (num(ctx.body, 'breakAttempt') ?? null),
    startActive: true,
  });
  match.seats[0].ready = true;
  match.seats[1].ready = true;
  await query('update matches set state = $2 where id = $1', [match.id, JSON.stringify(match)]);
  return { id: match.id, url: `/match/${match.id}`, code: null };
}

export async function gradingShot(ctx: Ctx): Promise<Record<string, unknown>> {
  const match = await getMatch(ctx.params.id);
  if (match === null) throw notFound();
  const seat = (num(ctx.body, 'seat') ?? 0) === 1 ? 1 : 0;
  const eventsBody = ctx.body.events as Record<string, unknown> | undefined;
  const pocketed = Array.isArray(eventsBody?.pocketed)
    ? (eventsBody?.pocketed as { id: PieceId; pocket: 'nw' | 'ne' | 'sw' | 'se' }[])
    : [];
  const events: ShotEvents = {
    firstContact:
      typeof eventsBody?.firstContact === 'string'
        ? (eventsBody.firstContact as PieceId | 'cushion')
        : null,
    pocketed,
    strikerPocketed: eventsBody?.strikerPocketed === true,
  };
  const finalBody = Array.isArray(ctx.body.final) ? ctx.body.final : [];
  const final = finalBody.map((entry) => {
    const row = entry as Record<string, unknown>;
    return { id: String(row.id), x: Number(row.x ?? 0), y: Number(row.y ?? 0) };
  });
  const result = await applyRuledEvents(match, seat, events, final);
  return { ...result, match: matchJson(match) };
}

export function gradingSimulate(ctx: Ctx): Record<string, unknown> {
  const bodies = [];
  const intentBody = ctx.body.intent as Record<string, unknown> | undefined;
  if (intentBody !== undefined && intentBody !== null) {
    const seat = (Number(intentBody.seat) === 1 ? 1 : 0) as Seat;
    const offset = Number(intentBody.x ?? 0);
    const dx = Number(intentBody.dx ?? 0);
    const dy = Number(intentBody.dy ?? 0);
    const p = Number(intentBody.p ?? 0);
    const speed = STRIKER_SPEED_PER_POWER * p;
    bodies.push(makeBody('striker', offsetToBoardX(offset, seat), baselineY(seat), dx * speed, dy * speed));
  }
  const piecesBody = Array.isArray(ctx.body.pieces) ? ctx.body.pieces : [];
  for (const entry of piecesBody) {
    const row = entry as Record<string, unknown>;
    bodies.push(
      makeBody(String(row.id), Number(row.x ?? 0), Number(row.y ?? 0), Number(row.vx ?? 0), Number(row.vy ?? 0)),
    );
  }
  const result = simulate(bodies);
  return {
    events: result.events,
    frames: result.frames,
    final: result.final,
    durationSeconds: result.durationSeconds,
    maxSpeedAtRest: result.maxSpeedAtRest,
  };
}
