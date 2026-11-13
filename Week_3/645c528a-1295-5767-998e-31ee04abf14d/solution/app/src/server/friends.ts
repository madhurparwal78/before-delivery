import { randomBytes, randomUUID } from 'node:crypto';
import { query, transaction } from './db';
import { ApiError, isUniqueViolation, notFound, validationFailed } from './errors';
import { route, openRoute } from './http';
import { config } from './config';
import { isOnline, sendToPlayer } from './realtime';
import { inLiveMatch, openRoom, seatFor, seatInvitee, setInvite } from './tables';

interface PersonRow {
  id: string;
  display_name: string;
}

const EXPIRED = 'Expired';

function presence(playerId: string): 'online' | 'in_match' | 'offline' {
  if (!isOnline(playerId)) return 'offline';
  return inLiveMatch(playerId) ? 'in_match' : 'online';
}

function touchFriends(playerId: string): void {
  sendToPlayer(playerId, { topic: 'friends' });
}

export async function announcePresence(playerId: string): Promise<void> {
  const rows = await query<{ player_id: string }>('SELECT player_id FROM friendships WHERE friend_id = $1', [playerId]);
  rows.forEach(({ player_id: friend }) => touchFriends(friend));
}

async function liveInvite(token: string): Promise<{ match_id: string; display_name: string }> {
  const rows = await query<{ match_id: string; display_name: string; expired: boolean; status: string }>(
    `SELECT i.match_id, p.display_name, i.expires_at <= now() AS expired, m.status FROM invites i
     JOIN matches m ON m.id = i.match_id JOIN players p ON p.id = m.seat_one WHERE i.token = $1`,
    [token],
  );
  if (rows.length === 0 || (rows[0].expired && rows[0].status !== 'in_play')) throw new ApiError(410, 'invite_expired', EXPIRED);
  return rows[0];
}

export function registerFriendRoutes(): void {
  route('GET', '/api/friends', async ({ session }) => {
    const id = session.playerId;
    const own = await query<{ friend_code: string }>('SELECT friend_code FROM players WHERE id = $1', [id]);
    const friends = await query<PersonRow>(
      'SELECT p.id, p.display_name FROM friendships f JOIN players p ON p.id = f.friend_id WHERE f.player_id = $1 ORDER BY p.display_name',
      [id],
    );
    const incoming = await query<PersonRow & { request_id: string }>(
      'SELECT r.id AS request_id, p.id, p.display_name FROM friend_requests r JOIN players p ON p.id = r.from_player WHERE r.to_player = $1',
      [id],
    );
    const outgoing = await query<PersonRow & { request_id: string }>(
      'SELECT r.id AS request_id, p.id, p.display_name FROM friend_requests r JOIN players p ON p.id = r.to_player WHERE r.from_player = $1',
      [id],
    );
    const blocked = await query<PersonRow>('SELECT p.id, p.display_name FROM blocks b JOIN players p ON p.id = b.blocked_id WHERE b.blocker_id = $1', [id]);
    const person = (row: PersonRow & { request_id: string }): object => ({ requestId: row.request_id, id: row.id, displayName: row.display_name });
    return {
      status: 200,
      body: {
        friendCode: own[0].friend_code,
        friends: friends.map((friend) => ({ id: friend.id, displayName: friend.display_name, presence: presence(friend.id) })),
        incoming: incoming.map(person),
        outgoing: outgoing.map(person),
        blocked: blocked.map((row) => ({ id: row.id, displayName: row.display_name })),
      },
    };
  });

  route('POST', '/api/friends/requests', async ({ session, body }) => {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const answer = await transaction(async (client) => {
      const target = await client.query<PersonRow>('SELECT id, display_name FROM players WHERE friend_code = $1', [code]);
      if (target.rows.length === 0) throw new ApiError(404, 'unknown_code', 'No player has that code.');
      const other = target.rows[0];
      const pair = [session.playerId, other.id];
      const blocked = await client.query('SELECT 1 FROM blocks WHERE blocker_id = ANY($1) AND blocked_id = ANY($1)', [pair]);
      if (blocked.rows.length > 0) throw new ApiError(403, 'blocked', "You can't add this player.");
      const friends = await client.query('SELECT 1 FROM friendships WHERE player_id = $1 AND friend_id = $2', pair);
      if (friends.rows.length > 0) throw new ApiError(409, 'already_friends', 'You are already friends.');
      const pending = await client.query(
        'SELECT 1 FROM friend_requests WHERE (from_player = $1 AND to_player = $2) OR (from_player = $2 AND to_player = $1)',
        pair,
      );
      if (pending.rows.length > 0) throw new ApiError(409, 'request_pending', 'A request is already waiting.');
      if (other.id === session.playerId) throw validationFailed({ code: 'That is your own code.' });
      const requestId = randomUUID();
      await client.query('INSERT INTO friend_requests (id, from_player, to_player) VALUES ($1,$2,$3)', [requestId, session.playerId, other.id]);
      return { requestId, targetId: other.id };
    }).catch((error: unknown) => {
      throw isUniqueViolation(error) ? new ApiError(409, 'request_pending', 'A request is already waiting.') : error;
    });
    touchFriends(answer.targetId);
    return { status: 201, body: { requestId: answer.requestId } };
  }, { body: true });

  route('POST', '/api/friends/requests/{id}/accept', async ({ session, params }) => {
    const from = await transaction(async (client) => {
      const { rows } = await client.query<{ from_player: string; to_player: string }>('DELETE FROM friend_requests WHERE id::text = $1 RETURNING from_player, to_player', [params.id]);
      if (rows.length === 0) throw notFound();
      if (rows[0].to_player !== session.playerId) throw new ApiError(403, 'forbidden', 'This request is not yours.');
      await client.query('INSERT INTO friendships VALUES ($1,$2), ($2,$1) ON CONFLICT DO NOTHING', [rows[0].from_player, rows[0].to_player]);
      return rows[0].from_player;
    });
    touchFriends(from);
    return { status: 200, body: { status: 'accepted' } };
  });

  route('POST', '/api/friends/requests/{id}/decline', async ({ session, params }) => {
    await transaction(async (client) => {
      const { rows } = await client.query<{ to_player: string }>('DELETE FROM friend_requests WHERE id::text = $1 RETURNING to_player', [params.id]);
      if (rows.length === 0) throw notFound();
      if (rows[0].to_player !== session.playerId) throw new ApiError(403, 'forbidden', 'This request is not yours.');
    });
    return { status: 204 };
  });

  route('POST', '/api/friends/{playerId}/block', async ({ session, params }) => {
    await transaction(async (client) => {
      const { rows } = await client.query('SELECT 1 FROM players WHERE id::text = $1', [params.playerId]);
      if (rows.length === 0) throw notFound();
      const pair = [session.playerId, params.playerId];
      await client.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', pair);
      await client.query('DELETE FROM friendships WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)', pair);
      await client.query('DELETE FROM friend_requests WHERE (from_player = $1 AND to_player = $2) OR (from_player = $2 AND to_player = $1)', pair);
    });
    touchFriends(params.playerId);
    return { status: 204 };
  });

  route('DELETE', '/api/friends/{playerId}/block', async ({ session, params }) => {
    await query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id::text = $2', [session.playerId, params.playerId]);
    return { status: 204 };
  });

  route('POST', '/api/private-tables', async ({ session, origin }) => {
    if (inLiveMatch(session.playerId)) throw new ApiError(409, 'in_match', 'You are already in a match.');
    const token = randomBytes(18).toString('base64url');
    const inviteUrl = `${origin}/invite/${token}`;
    const endsAt = Date.now() + config.inviteTtlSeconds * 1000;
    const tableId = await transaction(async (client) => {
      const room = await openRoom(client, { kind: 'private', mode: 'eight-ball', tier: 1, seats: [await seatFor(client, session.playerId, session.id)] });
      await client.query('INSERT INTO invites (token, match_id, expires_at) VALUES ($1,$2,to_timestamp($3))', [token, room.id, endsAt / 1000]);
      return room.id;
    });
    await setInvite(tableId, inviteUrl, endsAt);
    return { status: 201, body: { tableId, tableUrl: `/table/${tableId}`, inviteUrl } };
  });

  openRoute('GET', '/api/invites/{token}', async ({ params }) => {
    const invite = await liveInvite(params.token);
    return { status: 200, body: { status: 'open', hostName: invite.display_name } };
  });

  route('POST', '/api/invites/{token}/accept', async ({ session, params }) => {
    const invite = await liveInvite(params.token);
    return { status: 200, body: { tableUrl: await seatInvitee(invite.match_id, session) } };
  });
}
