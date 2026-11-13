import type {
  Friendship,
  FriendsPayload,
  FriendshipPayload,
  RequestPayload,
  User,
} from '../../shared/types.js';
import { type Tx, query, queryOne, transaction } from '../db.js';
import { fail, validationFailed } from '../errors.js';
import { type UserRow, findByHandle, toUser } from './accounts.js';
import { presenceFor } from './presence.js';

interface IdHandleRow {
  id: number;
  handle: string;
}

export async function areFriends(a: number, b: number): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT true AS ok FROM friendships WHERE low_user_id = $1 AND high_user_id = $2`,
    [Math.min(a, b), Math.max(a, b)],
  );
  return row !== null;
}

export async function blockExists(a: number, b: number): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT true AS ok FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [a, b],
  );
  return row !== null;
}

/** Friends whose presence and messages may pass, which excludes blocked pairs. */
export async function visibleFriendIds(userId: number): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT CASE WHEN f.low_user_id = $1 THEN f.high_user_id ELSE f.low_user_id END AS id
     FROM friendships f
     WHERE $1 IN (f.low_user_id, f.high_user_id)
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = f.low_user_id AND b.blocked_id = f.high_user_id)
            OR (b.blocker_id = f.high_user_id AND b.blocked_id = f.low_user_id))`,
    [userId],
  );
  return rows.map((row) => row.id);
}

export async function friendsPayload(userId: number): Promise<FriendsPayload> {
  const friendRows = await query<IdHandleRow & { since: Date }>(
    `SELECT u.id, u.handle, f.since
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.low_user_id = $1 THEN f.high_user_id ELSE f.low_user_id END
     WHERE $1 IN (f.low_user_id, f.high_user_id)
     ORDER BY u.handle`,
    [userId],
  );
  const presence = await presenceFor(friendRows.map((row) => row.id));
  const incoming = await query<{ id: number; sent_at: Date; from_id: number; handle: string }>(
    `SELECT r.id, r.sent_at, u.id AS from_id, u.handle
     FROM friend_requests r JOIN users u ON u.id = r.from_user_id
     WHERE r.to_user_id = $1 ORDER BY r.id`,
    [userId],
  );
  const outgoing = await query<{ id: number; sent_at: Date; to_id: number; handle: string }>(
    `SELECT r.id, r.sent_at, u.id AS to_id, u.handle
     FROM friend_requests r JOIN users u ON u.id = r.to_user_id
     WHERE r.from_user_id = $1 ORDER BY r.id`,
    [userId],
  );
  const blocked = await query<IdHandleRow>(
    `SELECT u.id, u.handle FROM blocks b JOIN users u ON u.id = b.blocked_id
     WHERE b.blocker_id = $1 ORDER BY u.handle`,
    [userId],
  );
  return {
    friends: friendRows.map((row) => ({
      user: toUser(row),
      presence: presence.get(row.id) ?? 'offline',
      since: row.since.toISOString(),
    })),
    incoming: incoming.map((row) => ({
      id: row.id,
      from: toUser({ id: row.from_id, handle: row.handle }),
      sentAt: row.sent_at.toISOString(),
    })),
    outgoing: outgoing.map((row) => ({
      id: row.id,
      to: toUser({ id: row.to_id, handle: row.handle }),
      sentAt: row.sent_at.toISOString(),
    })),
    blocked: blocked.map(toUser),
  };
}

export async function friendshipWith(userId: number, otherId: number): Promise<Friendship> {
  if (userId === otherId) return 'none';
  const block = await queryOne<{ blocker_id: number }>(
    `SELECT blocker_id FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
     ORDER BY blocker_id = $1 DESC LIMIT 1`,
    [userId, otherId],
  );
  if (block !== null) return block.blocker_id === userId ? 'blocked' : 'blocked_by';
  if (await areFriends(userId, otherId)) return 'friends';
  const request = await queryOne<{ from_user_id: number }>(
    `SELECT from_user_id FROM friend_requests
     WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)`,
    [userId, otherId],
  );
  if (request === null) return 'none';
  return request.from_user_id === userId ? 'pending_out' : 'pending_in';
}

async function insertFriendship(tx: Tx, a: number, b: number): Promise<Date> {
  const row = await tx.queryOne<{ since: Date }>(
    `INSERT INTO friendships (low_user_id, high_user_id) VALUES ($1, $2) RETURNING since`,
    [Math.min(a, b), Math.max(a, b)],
  );
  if (row === null) throw fail.internal();
  return row.since;
}

async function lockPair(tx: Tx, a: number, b: number): Promise<void> {
  await tx.query('SELECT id FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE', [a, b]);
}

export type RequestOutcome =
  | { kind: 'created'; request: RequestPayload }
  | { kind: 'replayed'; request: RequestPayload }
  | { kind: 'merged'; friendship: FriendshipPayload };

/**
 * Sends a friend request. A crossed request accepts the one already pending,
 * so two players who ask at the same moment end up with one accepted friendship.
 */
export async function sendRequest(me: UserRow, handle: string): Promise<RequestOutcome> {
  const target = await findByHandle(handle);
  if (target === null) throw fail.userNotFound();
  if (target.id === me.id) throw validationFailed({ handle: "You can't add yourself." });
  return transaction(async (tx) => {
    await lockPair(tx, me.id, target.id);
    const friendship = await tx.queryOne<{ since: Date }>(
      `SELECT since FROM friendships WHERE low_user_id = $1 AND high_user_id = $2`,
      [Math.min(me.id, target.id), Math.max(me.id, target.id)],
    );
    if (friendship !== null) throw fail.alreadyFriends();
    const block = await tx.queryOne<{ ok: boolean }>(
      `SELECT true AS ok FROM blocks
       WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [me.id, target.id],
    );
    if (block !== null) throw fail.blocked();
    const existing = await tx.queryOne<{ id: number; from_user_id: number; sent_at: Date }>(
      `SELECT id, from_user_id, sent_at FROM friend_requests
       WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)`,
      [me.id, target.id],
    );
    if (existing !== null && existing.from_user_id === me.id) {
      return {
        kind: 'replayed',
        request: {
          id: existing.id,
          to: toUser(target),
          status: 'pending',
          sentAt: existing.sent_at.toISOString(),
        },
      };
    }
    if (existing !== null) {
      await tx.query('DELETE FROM friend_requests WHERE id = $1', [existing.id]);
      const since = await insertFriendship(tx, me.id, target.id);
      return {
        kind: 'merged',
        friendship: { user: toUser(target), status: 'accepted', since: since.toISOString() },
      };
    }
    const created = await tx.queryOne<{ id: number; sent_at: Date }>(
      `INSERT INTO friend_requests (from_user_id, to_user_id) VALUES ($1, $2)
       RETURNING id, sent_at`,
      [me.id, target.id],
    );
    if (created === null) throw fail.internal();
    return {
      kind: 'created',
      request: {
        id: created.id,
        to: toUser(target),
        status: 'pending',
        sentAt: created.sent_at.toISOString(),
      },
    };
  });
}

export async function acceptRequest(
  me: UserRow,
  requestId: number,
): Promise<{ friendship: FriendshipPayload; otherId: number }> {
  return transaction(async (tx) => {
    const request = await tx.queryOne<{ from_user_id: number }>(
      `DELETE FROM friend_requests WHERE id = $1 AND to_user_id = $2 RETURNING from_user_id`,
      [requestId, me.id],
    );
    if (request === null) throw fail.requestNotFound();
    const other = await tx.queryOne<IdHandleRow>('SELECT id, handle FROM users WHERE id = $1', [
      request.from_user_id,
    ]);
    if (other === null) throw fail.requestNotFound();
    const since = await insertFriendship(tx, me.id, other.id);
    return {
      friendship: { user: toUser(other), status: 'accepted', since: since.toISOString() },
      otherId: other.id,
    };
  });
}

export async function declineRequest(me: UserRow, requestId: number): Promise<number> {
  const row = await queryOne<{ from_user_id: number }>(
    `DELETE FROM friend_requests WHERE id = $1 AND to_user_id = $2 RETURNING from_user_id`,
    [requestId, me.id],
  );
  if (row === null) throw fail.requestNotFound();
  return row.from_user_id;
}

export async function withdrawRequest(me: UserRow, requestId: number): Promise<number> {
  const row = await queryOne<{ to_user_id: number }>(
    `DELETE FROM friend_requests WHERE id = $1 AND from_user_id = $2 RETURNING to_user_id`,
    [requestId, me.id],
  );
  if (row === null) throw fail.requestNotFound();
  return row.to_user_id;
}

export async function removeFriend(me: UserRow, otherId: number): Promise<void> {
  const row = await queryOne<{ low_user_id: number }>(
    `DELETE FROM friendships WHERE low_user_id = $1 AND high_user_id = $2 RETURNING low_user_id`,
    [Math.min(me.id, otherId), Math.max(me.id, otherId)],
  );
  if (row === null) throw fail.notFriends();
}

export interface BlockOutcome {
  created: boolean;
  blocked: User;
  cancelledInvitePartyIds: number[];
}

/**
 * Blocking removes the friendship and cancels friend requests and party invites
 * both ways, in one transaction.
 */
export async function blockUser(me: UserRow, targetId: number): Promise<BlockOutcome> {
  if (targetId === me.id) {
    throw validationFailed({ userId: "You can't block yourself." });
  }
  const target = await queryOne<IdHandleRow>('SELECT id, handle FROM users WHERE id = $1', [
    targetId,
  ]);
  if (target === null) throw fail.userNotFound();
  return transaction(async (tx) => {
    await lockPair(tx, me.id, target.id);
    const existing = await tx.queryOne<{ ok: boolean }>(
      `SELECT true AS ok FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [me.id, target.id],
    );
    if (existing !== null) {
      return { created: false, blocked: toUser(target), cancelledInvitePartyIds: [] };
    }
    await tx.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [
      me.id,
      target.id,
    ]);
    await tx.query(
      `DELETE FROM friendships WHERE low_user_id = $1 AND high_user_id = $2`,
      [Math.min(me.id, target.id), Math.max(me.id, target.id)],
    );
    await tx.query(
      `DELETE FROM friend_requests
       WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)`,
      [me.id, target.id],
    );
    const invites = await tx.query<{ party_id: number }>(
      `DELETE FROM party_invites
       WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)
       RETURNING party_id`,
      [me.id, target.id],
    );
    return {
      created: true,
      blocked: toUser(target),
      cancelledInvitePartyIds: invites.map((row) => row.party_id),
    };
  });
}

export async function unblockUser(me: UserRow, targetId: number): Promise<void> {
  const row = await queryOne<{ blocker_id: number }>(
    `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2 RETURNING blocker_id`,
    [me.id, targetId],
  );
  if (row === null) throw fail.notBlocked();
}
