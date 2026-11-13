import { randomBytes, randomUUID } from 'node:crypto';
import { FRIENDS_COPY } from '../../shared/copy.js';
import { config, publicOrigin } from '../config.js';
import { query, queryOne } from '../db.js';
import { ApiError } from '../errors.js';
import { isOnline, publish } from '../events.js';
import { objectBody, type Ctx, type Router } from '../http.js';
import { requireSession } from '../session.js';
import { createMatchRow, loadMatch, playerHasLiveMatch, publishTable } from '../tables.js';

export type Presence = 'online' | 'in_match' | 'offline';

export async function presenceOf(playerId: string): Promise<Presence> {
  if (await playerHasLiveMatch(playerId)) return 'in_match';
  return isOnline(playerId) ? 'online' : 'offline';
}

export async function friendIdsOf(playerId: string): Promise<string[]> {
  const rows = await query<{ friend_id: string }>(`SELECT friend_id FROM friendships WHERE player_id = $1`, [playerId]);
  return rows.map((row) => row.friend_id);
}

export function registerSocialRoutes(router: Router): void {
  router.get('/api/friends', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const friends = await query<{ id: string; display_name: string }>(
      `SELECT p.id, p.display_name FROM friendships f JOIN players p ON p.id = f.friend_id
        WHERE f.player_id = $1 AND p.deleted = FALSE ORDER BY p.display_name`,
      [player.id],
    );
    const incoming = await query<{ id: string; from_id: string; display_name: string }>(
      `SELECT r.id, r.from_id, p.display_name FROM friend_requests r JOIN players p ON p.id = r.from_id
        WHERE r.to_id = $1 AND r.status = 'pending' ORDER BY r.created_at`,
      [player.id],
    );
    const outgoing = await query<{ id: string; to_id: string; display_name: string }>(
      `SELECT r.id, r.to_id, p.display_name FROM friend_requests r JOIN players p ON p.id = r.to_id
        WHERE r.from_id = $1 AND r.status = 'pending' ORDER BY r.created_at`,
      [player.id],
    );
    const blocked = await query<{ blocked_id: string; display_name: string }>(
      `SELECT b.blocked_id, p.display_name FROM blocks b JOIN players p ON p.id = b.blocked_id WHERE b.blocker_id = $1`,
      [player.id],
    );
    const withPresence = [];
    for (const friend of friends) {
      withPresence.push({ id: friend.id, displayName: friend.display_name, presence: await presenceOf(friend.id) });
    }
    return {
      status: 200,
      body: {
        friendCode: player.friend_code,
        friends: withPresence,
        incoming: incoming.map((row) => ({ requestId: row.id, id: row.from_id, displayName: row.display_name })),
        outgoing: outgoing.map((row) => ({ requestId: row.id, id: row.to_id, displayName: row.display_name })),
        blocked: blocked.map((row) => ({ id: row.blocked_id, displayName: row.display_name })),
      },
    };
  });

  router.post('/api/friends/requests', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const body = objectBody(ctx);
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!code) throw ApiError.validation({ code: 'Enter a friend code.' });
    if (code === player.friend_code) throw ApiError.validation({ code: 'That is your own code.' });
    const target = await queryOne<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM players WHERE friend_code = $1 AND deleted = FALSE`,
      [code],
    );
    if (!target) throw new ApiError(404, 'unknown_code', FRIENDS_COPY.unknownCode);
    const blocked = await queryOne(
      `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [player.id, target.id],
    );
    if (blocked) throw new ApiError(403, 'blocked', FRIENDS_COPY.blocked);
    const already = await queryOne(`SELECT 1 FROM friendships WHERE player_id = $1 AND friend_id = $2`, [player.id, target.id]);
    if (already) throw new ApiError(409, 'already_friends', 'You are already friends.');
    const pending = await queryOne(
      `SELECT 1 FROM friend_requests WHERE status = 'pending' AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))`,
      [player.id, target.id],
    );
    if (pending) throw new ApiError(409, 'request_pending', 'That request is already waiting.');
    const id = randomUUID();
    await query(`INSERT INTO friend_requests (id, from_id, to_id) VALUES ($1,$2,$3)`, [id, player.id, target.id]);
    publish(`player:${target.id}`, 'friends', { changed: true });
    return { status: 201, body: { requestId: id, displayName: target.display_name } };
  });

  router.post('/api/friends/requests/:id/accept', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const request = await queryOne<{ from_id: string; to_id: string; status: string }>(
      `SELECT from_id, to_id, status FROM friend_requests WHERE id = $1`,
      [ctx.params.id as string],
    );
    if (!request) throw ApiError.notFound('No such request.');
    if (request.to_id !== player.id || request.status !== 'pending') {
      throw new ApiError(403, 'not_yours', 'That request is not yours.');
    }
    await query(`UPDATE friend_requests SET status = 'accepted' WHERE id = $1`, [ctx.params.id as string]);
    await query(
      `INSERT INTO friendships (player_id, friend_id) VALUES ($1,$2), ($2,$1) ON CONFLICT DO NOTHING`,
      [request.from_id, request.to_id],
    );
    publish(`player:${request.from_id}`, 'friends', { changed: true });
    publish(`player:${request.to_id}`, 'friends', { changed: true });
    return { status: 200, body: { status: 'accepted' } };
  });

  router.post('/api/friends/requests/:id/decline', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const request = await queryOne<{ to_id: string; status: string }>(`SELECT to_id, status FROM friend_requests WHERE id = $1`, [
      ctx.params.id as string,
    ]);
    if (!request) throw ApiError.notFound('No such request.');
    if (request.to_id !== player.id || request.status !== 'pending') {
      throw new ApiError(403, 'not_yours', 'That request is not yours.');
    }
    await query(`UPDATE friend_requests SET status = 'declined' WHERE id = $1`, [ctx.params.id as string]);
    return { status: 204, body: null };
  });

  router.post('/api/friends/:playerId/block', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const targetId = ctx.params.playerId as string;
    await query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [player.id, targetId]);
    await query(`DELETE FROM friendships WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)`, [player.id, targetId]);
    await query(
      `UPDATE friend_requests SET status = 'declined'
        WHERE status = 'pending' AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))`,
      [player.id, targetId],
    );
    publish(`player:${targetId}`, 'friends', { changed: true });
    return { status: 204, body: null };
  });

  router.delete('/api/friends/:playerId/block', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    await query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [player.id, ctx.params.playerId as string]);
    return { status: 204, body: null };
  });

  router.post('/api/private-tables', async (ctx: Ctx) => {
    const { player, sessionId } = await requireSession(ctx);
    if (await playerHasLiveMatch(player.id)) throw new ApiError(409, 'in_match', 'Finish your match first.');
    const match = await createMatchRow({
      mode: 'eight-ball',
      tier: null,
      kind: 'private',
      seat1: player.id,
      seat2: null,
      seat1Session: sessionId,
      status: 'waiting',
      entry: 0,
      pot: 0,
      hostId: player.id,
    });
    const token = randomBytes(18).toString('hex');
    await query(`INSERT INTO invites (token, match_id, host_id, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' seconds')::interval)`, [
      token,
      match.id,
      player.id,
      String(config.inviteTtlSeconds),
    ]);
    return {
      status: 201,
      body: {
        tableId: match.id,
        tableUrl: `/table/${match.id}`,
        inviteUrl: `${publicOrigin(ctx.origin)}/invite/${token}`,
      },
    };
  });

  router.get('/api/invites/:token', async (ctx: Ctx) => {
    const invite = await loadInvite(ctx.params.token as string);
    return { status: 200, body: { status: 'open', hostName: invite.hostName } };
  });

  router.post('/api/invites/:token/accept', async (ctx: Ctx) => {
    const { player, sessionId } = await requireSession(ctx);
    const invite = await loadInvite(ctx.params.token as string);
    const match = await loadMatch(invite.matchId);
    if (!match) throw new ApiError(410, 'invite_expired', FRIENDS_COPY.expired);
    if (match.seat1 === player.id || match.seat2 === player.id) {
      const column = match.seat1 === player.id ? 'seat1_session' : 'seat2_session';
      await query(`UPDATE matches SET ${column} = $1 WHERE id = $2`, [sessionId, match.id]);
      return { status: 200, body: { tableUrl: `/table/${match.id}` } };
    }
    if (match.seat2) throw new ApiError(409, 'table_full', 'That table already has two players.');
    if (await playerHasLiveMatch(player.id)) throw new ApiError(409, 'in_match', 'Finish your match first.');
    await query(`UPDATE matches SET seat2 = $1, seat2_session = $2, status = 'in_play' WHERE id = $3`, [player.id, sessionId, match.id]);
    await publishTable(match.id);
    return { status: 200, body: { tableUrl: `/table/${match.id}` } };
  });
}

async function loadInvite(token: string): Promise<{ matchId: string; hostName: string }> {
  const invite = await queryOne<{ match_id: string; display_name: string; expired: boolean }>(
    `SELECT i.match_id, p.display_name, (i.expires_at < now()) AS expired
       FROM invites i JOIN players p ON p.id = i.host_id WHERE i.token = $1`,
    [token],
  );
  if (!invite || invite.expired) throw new ApiError(410, 'invite_expired', FRIENDS_COPY.expired);
  return { matchId: invite.match_id, hostName: invite.display_name };
}
