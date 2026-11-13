import { randomUUID } from 'node:crypto';
import { NO_GUIDELINES_MIN_LEVEL, tierOf } from '../../shared/catalog.js';
import { PLAY_COPY } from '../../shared/copy.js';
import { requiresCalledPocket } from '../../shared/referee.js';
import { HEAD_STRING_ALONG } from '../../shared/table-geometry.js';
import type { Mode, Seat } from '../../shared/types.js';
import { query, queryOne, transaction } from '../db.js';
import { ApiError } from '../errors.js';
import { objectBody, type Ctx, type Router } from '../http.js';
import { serialiseLine, type LedgerLineRow } from '../ledger.js';
import { publish } from '../events.js';
import { requireSession } from '../session.js';
import {
  claimSeat,
  clockExpired,
  createMatchRow,
  escrowEntries,
  handleExpiredClock,
  loadMatch,
  markSeatSeen,
  namesOf,
  placeBall,
  pocketFromApi,
  playerHasLiveMatch,
  publishPlayer,
  publishTable,
  roomOf,
  seatOf,
  takeShot,
  tableBody,
  type MatchRow,
} from '../tables.js';

const MODES: Mode[] = ['eight-ball', 'nine-ball', 'no-guidelines'];

export function bandFor(waitMs: number): number {
  return 3 + 3 * Math.floor(waitMs / 10000);
}

async function requireSeat(ctx: Ctx, id: string): Promise<{ match: MatchRow; seat: Seat; sessionId: string; playerId: string }> {
  const { player, sessionId } = await requireSession(ctx);
  const match = await loadMatch(id);
  if (!match) throw ApiError.notFound(PLAY_COPY.unknownTable);
  const seat = seatOf(match, player.id);
  if (!seat) throw new ApiError(403, 'not_seated', PLAY_COPY.notYours);
  return { match, seat, sessionId, playerId: player.id };
}

function assertSeatedHere(match: MatchRow, seat: Seat, sessionId: string): void {
  const seated = seat === 1 ? match.seat1_session : match.seat2_session;
  if (seated !== sessionId) throw new ApiError(409, 'other_device', PLAY_COPY.secondDevice);
}

export function registerPlayRoutes(router: Router): void {
  router.post('/api/queue', async (ctx: Ctx) => {
    const { player, sessionId } = await requireSession(ctx);
    const body = objectBody(ctx);
    const mode = body.mode;
    const tierValue = body.tier;
    const fields: Record<string, string> = {};
    if (typeof mode !== 'string' || !MODES.includes(mode as Mode)) fields.mode = 'Pick a published mode.';
    if (typeof tierValue !== 'number' || !Number.isInteger(tierValue) || tierValue < 1 || tierValue > 5) {
      fields.tier = 'Pick a tier from 1 to 5.';
    }
    if (Object.keys(fields).length === 0) {
      const tier = tierOf(tierValue as number);
      if (mode === 'no-guidelines' && player.level < NO_GUIDELINES_MIN_LEVEL) {
        throw new ApiError(403, 'mode_locked', PLAY_COPY.modeLocked);
      }
      if (player.level < tier.minLevel) {
        throw new ApiError(403, 'level_locked', PLAY_COPY.lockedTier(tier.minLevel));
      }
      if (await playerHasLiveMatch(player.id)) throw new ApiError(409, 'in_match', 'You are already in a match.');
      const existing = await queryOne<{ id: string }>(`SELECT id FROM queue_tickets WHERE player_id = $1 AND status = 'queued'`, [player.id]);
      if (existing) throw new ApiError(409, 'already_queued', 'You are already in the queue.');
      if (Number(player.coins) < tier.entry) throw new ApiError(409, 'insufficient_coins', PLAY_COPY.insufficientCoins);
      const id = randomUUID();
      await query(`INSERT INTO queue_tickets (id, player_id, session_id, mode, tier, status) VALUES ($1,$2,$3,$4,$5,'queued')`, [
        id,
        player.id,
        sessionId,
        mode,
        tier.tier,
      ]);
      void pairTickets();
      return { status: 201, body: { ticketId: id, status: 'queued' } };
    }
    throw ApiError.validation(fields);
  });

  router.get('/api/queue', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const ticket = await queryOne<{ id: string; status: string; table_id: string | null; created_at: Date; message: string | null }>(
      `SELECT id, status, table_id, created_at, message FROM queue_tickets WHERE player_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [player.id],
    );
    if (!ticket || ticket.status === 'cancelled') return { status: 200, body: { status: 'none' } };
    if (ticket.status === 'paired' && ticket.table_id) {
      return { status: 200, body: { status: 'paired', tableUrl: `/table/${ticket.table_id}` } };
    }
    if (ticket.status === 'failed') {
      return { status: 200, body: { status: 'none', message: ticket.message } };
    }
    const waited = Date.now() - new Date(ticket.created_at).getTime();
    return { status: 200, body: { status: 'queued', band: bandFor(waited) } };
  });

  router.delete('/api/queue', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const ticket = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM queue_tickets WHERE player_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [player.id],
    );
    if (!ticket || ticket.status === 'cancelled' || ticket.status === 'failed') {
      throw new ApiError(409, 'not_queued', 'You are not in the queue.');
    }
    if (ticket.status === 'paired') throw new ApiError(409, 'already_paired', 'You are already at a table.');
    await query(`UPDATE queue_tickets SET status = 'cancelled' WHERE id = $1`, [ticket.id]);
    return { status: 200, body: { status: 'cancelled' } };
  });

  router.get('/api/tables/:id', async (ctx: Ctx) => {
    const { player, sessionId } = await requireSession(ctx);
    const match = await loadMatch(ctx.params.id as string);
    if (!match) throw ApiError.notFound(PLAY_COPY.unknownTable);
    const seat = seatOf(match, player.id);
    if (!seat) throw new ApiError(403, 'not_seated', PLAY_COPY.notYours);
    await claimSeat(match, seat, sessionId);
    const names = await namesOf(match);
    const seated = seat === 1 ? match.seat1_session : match.seat2_session;
    if (seated === sessionId) markSeatSeen(match, seat, names);
    return { status: 200, body: await tableBody(match, { playerId: player.id, sessionId }) };
  });

  router.post('/api/tables/:id/shots', async (ctx: Ctx) => {
    const { match, seat, sessionId, playerId } = await requireSeat(ctx, ctx.params.id as string);
    assertSeatedHere(match, seat, sessionId);
    if (match.status !== 'in_play') throw new ApiError(409, 'match_over', 'This match is over.');
    const names = await namesOf(match);
    const room = roomOf(match, names);
    if (clockExpired(match) && match.state.activeSeat === seat) {
      await handleExpiredClock(match);
      throw new ApiError(409, 'shot_clock_expired', PLAY_COPY.lateShot);
    }
    if (room.expiredSeat === seat) throw new ApiError(409, 'shot_clock_expired', PLAY_COPY.lateShot);
    if (match.state.activeSeat !== seat) throw new ApiError(409, 'not_your_turn', 'It is not your shot.');

    const body = objectBody(ctx);
    const fields: Record<string, string> = {};
    const allowed = ['aimDegrees', 'power', 'sideSpin', 'topSpin', 'calledPocket'];
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) fields[key] = 'Not accepted.';
    }
    const aimDegrees = numberField(body.aimDegrees, 0, 359.9, fields, 'aimDegrees');
    const power = numberField(body.power, 0, 100, fields, 'power');
    const sideSpin = numberField(body.sideSpin, -100, 100, fields, 'sideSpin');
    const topSpin = numberField(body.topSpin, -100, 100, fields, 'topSpin');
    const calledPocket = body.calledPocket === null || body.calledPocket === undefined ? null : pocketFromApi(body.calledPocket);
    if (body.calledPocket !== null && body.calledPocket !== undefined && calledPocket === null) {
      fields.calledPocket = 'Pick a published pocket.';
    }
    if (requiresCalledPocket(match.state, seat) && !calledPocket) {
      throw new ApiError(409, 'called_pocket_required', 'Call a pocket before you shoot.');
    }
    if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

    await takeShot(match, {
      seat,
      shot: { aimDegrees, power, sideSpin, topSpin, calledPocket },
    });
    publishPlayer(playerId);
    return { status: 200, body: await tableBody(match, { playerId, sessionId }) };
  });

  router.post('/api/tables/:id/place', async (ctx: Ctx) => {
    const { match, seat, sessionId, playerId } = await requireSeat(ctx, ctx.params.id as string);
    assertSeatedHere(match, seat, sessionId);
    if (match.status !== 'in_play') throw new ApiError(409, 'match_over', 'This match is over.');
    if (match.state.activeSeat !== seat) throw new ApiError(409, 'not_your_turn', 'It is not your shot.');
    if (!match.state.ballInHand) throw new ApiError(409, 'no_ball_in_hand', 'You do not have ball in hand.');

    const body = objectBody(ctx);
    const fields: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== 'across' && key !== 'along') fields[key] = 'Not accepted.';
    }
    const across = numberField(body.across, 0, 100, fields, 'across');
    const along = numberField(body.along, 0, 100, fields, 'along');
    if (match.state.behindHeadString && along > HEAD_STRING_ALONG) {
      fields.along = 'Place the ball behind the head string.';
    }
    if (Object.keys(fields).length > 0) throw ApiError.validation(fields);
    const overlap = Object.entries(match.state.positions).some(([ball, point]) => {
      if (Number(ball) === 0) return false;
      return Math.hypot(point.across - across, (point.along - along) * 2) < 4.5;
    });
    if (overlap) throw new ApiError(409, 'cue_ball_overlap', 'That spot is taken by another ball.');
    await placeBall(match, seat, across, along);
    return { status: 200, body: await tableBody(match, { playerId, sessionId }) };
  });

  router.post('/api/tables/:id/rematch', async (ctx: Ctx) => {
    const { match, seat, sessionId, playerId } = await requireSeat(ctx, ctx.params.id as string);
    if (match.status === 'in_play' || match.status === 'waiting') {
      throw new ApiError(409, 'match_not_over', 'This match is still running.');
    }
    const entry = Number(match.entry);
    if (match.kind === 'stake' && entry > 0) {
      const wallet = await queryOne<{ coins: string }>(`SELECT coins FROM players WHERE id = $1`, [playerId]);
      if (Number(wallet?.coins ?? 0) < entry) throw new ApiError(409, 'insufficient_coins', PLAY_COPY.insufficientCoins);
    }
    const names = await namesOf(match);
    const room = roomOf(match, names);
    room.rematch.add(seat);
    await publishTable(match.id);
    if (room.rematch.size < 2) return { status: 202, body: { status: 'waiting' } };
    const next = await transaction(async (client) => {
      const created = await createMatchRow({
        mode: match.mode,
        tier: match.tier,
        kind: match.kind,
        seat1: match.seat1,
        seat2: match.seat2,
        seat1Session: match.seat1_session,
        seat2Session: match.seat2_session,
        status: 'in_play',
        entry,
        pot: Number(match.pot),
        client,
      });
      if (match.kind === 'stake' && entry > 0) {
        await escrowEntries(client, created.id, [match.seat1, match.seat2].filter((id): id is string => Boolean(id)), entry, 'match_entry');
      }
      return created;
    });
    room.rematch.clear();
    for (const id of [match.seat1, match.seat2]) {
      if (id) {
        publishPlayer(id);
        publish(`player:${id}`, 'queue', { status: 'paired', tableUrl: `/table/${next.id}` });
      }
    }
    void sessionId;
    return { status: 201, body: { tableUrl: `/table/${next.id}` } };
  });

  router.get('/api/matches/:id/ledger', async (ctx: Ctx) => {
    const { match } = await requireSeat(ctx, ctx.params.id as string);
    const lines = await query<LedgerLineRow>(`SELECT * FROM ledger_lines WHERE ref_id = $1 ORDER BY seq ASC`, [match.id]);
    return { status: 200, body: { lines: lines.map(serialiseLine) } };
  });
}

function numberField(value: unknown, min: number, max: number, fields: Record<string, string>, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fields[key] = 'Send a number.';
    return 0;
  }
  if (value < min || value > max) {
    fields[key] = `Use a number from ${min} to ${max}.`;
    return 0;
  }
  return value;
}

/** Longest-waiting fitting tickets pair first; the band widens with the longer wait. */
export async function pairTickets(): Promise<void> {
  const tickets = await query<{ id: string; player_id: string; mode: string; tier: number; created_at: Date; level: number; coins: string }>(
    `SELECT q.id, q.player_id, q.mode, q.tier, q.created_at, p.level, p.coins
       FROM queue_tickets q JOIN players p ON p.id = q.player_id
      WHERE q.status = 'queued' ORDER BY q.created_at ASC`,
  ).catch(() => []);
  const now = Date.now();
  const used = new Set<string>();
  for (let index = 0; index < tickets.length; index += 1) {
    const first = tickets[index];
    if (!first || used.has(first.id)) continue;
    for (let other = index + 1; other < tickets.length; other += 1) {
      const second = tickets[other];
      if (!second || used.has(second.id)) continue;
      if (first.mode !== second.mode || first.tier !== second.tier) continue;
      const waited = Math.max(now - new Date(first.created_at).getTime(), now - new Date(second.created_at).getTime());
      if (Math.abs(first.level - second.level) > bandFor(waited)) continue;
      used.add(first.id);
      used.add(second.id);
      await pairPair(first, second);
      break;
    }
  }
}

async function pairPair(
  first: { id: string; player_id: string; mode: string; tier: number },
  second: { id: string; player_id: string; mode: string; tier: number },
): Promise<void> {
  const tier = tierOf(first.tier);
  const result = await transaction(async (client) => {
    const locked = await client.query<{ id: string; player_id: string; status: string; session_id: string | null }>(
      `SELECT id, player_id, status, session_id FROM queue_tickets WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [[first.id, second.id]],
    );
    if (locked.rows.length !== 2 || locked.rows.some((row) => row.status !== 'queued')) return null;
    const wallets = await client.query<{ id: string; coins: string }>(
      `SELECT id, coins FROM players WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [[first.player_id, second.player_id]],
    );
    const short = wallets.rows.filter((row) => Number(row.coins) < tier.entry);
    if (short.length > 0) {
      for (const row of short) {
        await client.query(`UPDATE queue_tickets SET status = 'failed', message = $1 WHERE player_id = $2 AND status = 'queued'`, [
          PLAY_COPY.insufficientCoins,
          row.id,
        ]);
      }
      return null;
    }
    const seat1Session = locked.rows.find((row) => row.player_id === first.player_id)?.session_id ?? null;
    const seat2Session = locked.rows.find((row) => row.player_id === second.player_id)?.session_id ?? null;
    const match = await createMatchRow({
      mode: first.mode as Mode,
      tier: tier.tier,
      kind: 'stake',
      seat1: first.player_id,
      seat2: second.player_id,
      seat1Session,
      seat2Session,
      status: 'in_play',
      entry: tier.entry,
      pot: tier.pot,
      client,
    });
    await escrowEntries(client, match.id, [first.player_id, second.player_id], tier.entry, 'match_entry');
    await client.query(`UPDATE queue_tickets SET status = 'paired', table_id = $1 WHERE id = ANY($2::uuid[])`, [
      match.id,
      [first.id, second.id],
    ]);
    return match;
  }).catch(() => null);
  if (!result) return;
  for (const playerId of [first.player_id, second.player_id]) {
    publishPlayer(playerId);
    publish(`player:${playerId}`, 'queue', { status: 'paired', tableUrl: `/table/${result.id}` });
  }
}
