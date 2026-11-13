import type { Db } from './db.js';
import type { Ctx } from './http.js';
import { sendJson, sendEmpty } from './http.js';
import { ApiError, errors } from './errors.js';
import { copy } from './copy.js';
import { requirePlayerId } from './auth.js';
import { id as newId, randomToken } from './util.js';
import type { PresenceRegistry } from './presence.js';
import type { MatchService } from './matches.js';
import type { FriendsBody, FriendView } from '../shared/types.js';

export interface FriendsDeps {
  db: Db;
  presence: PresenceRegistry;
  matches: MatchService;
  onFriendsChange: (playerId: string) => void;
}

export async function getFriends(deps: FriendsDeps, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const body = await friendsBody(deps, playerId);
  sendJson(ctx, 200, body);
}

export async function friendsBody(deps: FriendsDeps, playerId: string): Promise<FriendsBody> {
  const me = (await deps.db.query<{ friend_code: string }>(`SELECT friend_code FROM players WHERE id = $1`, [playerId])).rows[0];
  const friends = await deps.db.query<{ id: string; display_name: string }>(
    `SELECT p.id, p.display_name FROM friends f JOIN players p ON p.id = f.friend_id WHERE f.player_id = $1 ORDER BY p.display_name`,
    [playerId]
  );
  const incoming = await deps.db.query<{ request_id: string; id: string; display_name: string }>(
    `SELECT r.id AS request_id, p.id, p.display_name FROM friend_requests r JOIN players p ON p.id = r.from_player WHERE r.to_player = $1 ORDER BY r.created_at`,
    [playerId]
  );
  const outgoing = await deps.db.query<{ request_id: string; id: string; display_name: string }>(
    `SELECT r.id AS request_id, p.id, p.display_name FROM friend_requests r JOIN players p ON p.id = r.to_player WHERE r.from_player = $1 ORDER BY r.created_at`,
    [playerId]
  );
  const blocked = await deps.db.query<{ id: string; display_name: string }>(
    `SELECT p.id, p.display_name FROM blocks b JOIN players p ON p.id = b.blocked_id WHERE b.player_id = $1 ORDER BY p.display_name`,
    [playerId]
  );

  const friendViews: FriendView[] = [];
  for (const row of friends.rows) {
    friendViews.push({ id: row.id, displayName: row.display_name, presence: await deps.presence.presence(deps.db, row.id) });
  }
  return {
    friendCode: me?.friend_code ?? '',
    friends: friendViews,
    incoming: incoming.rows.map((r) => ({ requestId: r.request_id, id: r.id, displayName: r.display_name })),
    outgoing: outgoing.rows.map((r) => ({ requestId: r.request_id, id: r.id, displayName: r.display_name })),
    blocked: blocked.rows.map((r) => ({ id: r.id, displayName: r.display_name })),
  };
}

export async function sendRequest(deps: FriendsDeps, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const body = ctx.body as { code?: string };
  const code = (body.code ?? '').trim().toUpperCase();

  const requestId = await deps.db.tx(async (client) => {
    const target = (await client.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM players WHERE friend_code = $1 AND deleted_at IS NULL`, [code])).rows[0];
    if (!target) throw new ApiError(404, 'unknown_code', copy.unknownCode);
    if (target.id === playerId) throw errors.validation({ code: 'That is your own code.' });
    const blockedEitherWay = (await client.query(
      `SELECT 1 FROM blocks WHERE (player_id = $1 AND blocked_id = $2) OR (player_id = $2 AND blocked_id = $1)`,
      [playerId, target.id]
    )).rowCount ?? 0;
    if (blockedEitherWay > 0) throw new ApiError(403, 'blocked', copy.blockedFriend);
    const already = (await client.query(`SELECT 1 FROM friends WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)`, [playerId, target.id])).rowCount ?? 0;
    if (already > 0) throw new ApiError(409, 'already_friends', 'You are already friends.');
    const pending = (await client.query(`SELECT 1 FROM friend_requests WHERE (from_player = $1 AND to_player = $2) OR (from_player = $2 AND to_player = $1)`, [playerId, target.id])).rowCount ?? 0;
    if (pending > 0) throw new ApiError(409, 'request_pending', 'A request is already pending.');
    const requestId = newId('freq');
    await client.query(`INSERT INTO friend_requests (id, from_player, to_player) VALUES ($1,$2,$3)`, [requestId, playerId, target.id]);
    return requestId;
  });
  deps.onFriendsChange(playerId);
  sendJson(ctx, 201, { requestId });
}

export async function acceptRequest(deps: FriendsDeps, ctx: Ctx, requestId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  await deps.db.tx(async (client) => {
    const req = (await client.query<{ from_player: string; to_player: string }>(`SELECT from_player, to_player FROM friend_requests WHERE id = $1 FOR UPDATE`, [requestId])).rows[0];
    if (!req || req.to_player !== playerId) throw errors.forbidden('That request is not yours.');
    await client.query(`DELETE FROM friend_requests WHERE id = $1`, [requestId]);
    await client.query(`INSERT INTO friends (player_id, friend_id) VALUES ($1,$2),($2,$1) ON CONFLICT DO NOTHING`, [req.from_player, req.to_player]);
  });
  deps.onFriendsChange(playerId);
  sendJson(ctx, 200, { status: 'accepted' });
}

export async function declineRequest(deps: FriendsDeps, ctx: Ctx, requestId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  await deps.db.tx(async (client) => {
    const req = (await client.query<{ to_player: string }>(`SELECT to_player FROM friend_requests WHERE id = $1 FOR UPDATE`, [requestId])).rows[0];
    if (!req || req.to_player !== playerId) throw errors.forbidden('That request is not yours.');
    await client.query(`DELETE FROM friend_requests WHERE id = $1`, [requestId]);
  });
  sendEmpty(ctx, 204);
}

export async function blockPlayer(deps: FriendsDeps, ctx: Ctx, targetId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  await deps.db.tx(async (client) => {
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    await client.query(`DELETE FROM friends WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)`, [playerId, targetId]);
    await client.query(`DELETE FROM friend_requests WHERE (from_player = $1 AND to_player = $2) OR (from_player = $2 AND to_player = $1)`, [playerId, targetId]);
    await client.query(`INSERT INTO blocks (player_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [playerId, targetId]);
  });
  deps.onFriendsChange(playerId);
  sendEmpty(ctx, 204);
}

export async function unblockPlayer(deps: FriendsDeps, ctx: Ctx, targetId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  await deps.db.query(`DELETE FROM blocks WHERE player_id = $1 AND blocked_id = $2`, [playerId, targetId]);
  sendEmpty(ctx, 204);
}

export async function createPrivateTable(deps: FriendsDeps, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const result = await deps.db.tx(async (client) => {
    const live = (await client.query(`SELECT 1 FROM matches WHERE status IN ('paired','in_play') AND (seat1_player = $1 OR seat2_player = $1) LIMIT 1`, [playerId])).rowCount ?? 0;
    if (live > 0) throw new ApiError(409, 'in_match', 'Finish your current match first.');
    const tableId = await deps.matches.createMatchRaw(client, {
      mode: 'eight-ball',
      tier: 1,
      kind: 'private',
      seat1: playerId,
      seat2: null,
      seat1Session: ctx.cookies['hs_session'] ?? null,
      seat2Session: null,
    });
    const token = randomToken(16);
    await client.query(`INSERT INTO invites (token, table_id, host_player, expires_at) VALUES ($1,$2,$3, now() + interval '${'900'} seconds')`, [token, tableId, playerId]);
    return { tableId, token };
  });
  sendJson(ctx, 201, {
    tableId: result.tableId,
    tableUrl: `/table/${result.tableId}`,
    inviteUrl: `${originOf(ctx)}/invite/${result.token}`,
  });
}

function originOf(ctx: Ctx): string {
  const proto = ctx.req.headers['x-forwarded-proto'] ?? 'http';
  const host = ctx.req.headers.host ?? '';
  return `${proto}://${host}`;
}

export async function getInvite(deps: FriendsDeps, ctx: Ctx, token: string): Promise<void> {
  const invite = (await deps.db.query<{ table_id: string; host_player: string; expires_at: Date; accepted_by: string | null }>(
    `SELECT table_id, host_player, expires_at, accepted_by FROM invites WHERE token = $1`, [token]
  )).rows[0];
  if (!invite || invite.expires_at.getTime() < Date.now() || invite.accepted_by) {
    throw new ApiError(410, 'invite_expired', copy.inviteExpired);
  }
  const host = (await deps.db.query<{ display_name: string }>(`SELECT display_name FROM players WHERE id = $1`, [invite.host_player])).rows[0];
  sendJson(ctx, 200, { status: 'open', hostName: host?.display_name ?? '' });
}

export async function acceptInvite(deps: FriendsDeps, ctx: Ctx, token: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const tableUrl = await deps.db.tx(async (client) => {
    const invite = (await client.query<{ table_id: string; host_player: string; expires_at: Date; accepted_by: string | null }>(
      `SELECT table_id, host_player, expires_at, accepted_by FROM invites WHERE token = $1 FOR UPDATE`, [token]
    )).rows[0];
    if (!invite || invite.expires_at.getTime() < Date.now() || invite.accepted_by) {
      throw new ApiError(410, 'invite_expired', copy.inviteExpired);
    }
    const match = (await client.query<{ seat1_player: string | null; seat2_player: string | null; status: string }>(
      `SELECT seat1_player, seat2_player, status FROM matches WHERE id = $1 FOR UPDATE`, [invite.table_id]
    )).rows[0];
    if (!match) throw new ApiError(410, 'invite_expired', copy.inviteExpired);
    if (match.seat2_player !== null && match.seat2_player !== playerId) {
      throw new ApiError(409, 'table_full', 'This table already has two players.');
    }
    const live = (await client.query(`SELECT 1 FROM matches WHERE status IN ('paired','in_play') AND (seat1_player = $1 OR seat2_player = $1) AND id <> $2 LIMIT 1`, [playerId, invite.table_id])).rowCount ?? 0;
    if (live > 0) throw new ApiError(409, 'in_match', 'Finish your current match first.');
    await client.query(`UPDATE matches SET seat2_player = $2, seat2_session = $3 WHERE id = $1`, [invite.table_id, playerId, ctx.cookies['hs_session'] ?? null]);
    await client.query(`UPDATE invites SET accepted_by = $2 WHERE token = $1`, [token, playerId]);
    return `/table/${invite.table_id}`;
  });
  sendJson(ctx, 200, { tableUrl });
}
