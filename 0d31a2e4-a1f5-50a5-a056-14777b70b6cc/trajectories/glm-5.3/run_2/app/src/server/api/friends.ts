import type { Pool, PoolClient } from "pg";
import type { UserPublic } from "../../shared/domain.js";
import { ApiError, err, FIELD_MESSAGES, serializable } from "../http.js";
import { areFriends, blockedBetween } from "../db/users.js";
import { toUserPublic } from "../db/public.js";

export type FriendState = "none" | "pending_in" | "pending_out" | "friends" | "blocked" | "blocked_by";

export type FriendRequestRow = {
  id: number;
  from_user: number;
  to_user: number;
  sent_at: Date;
};

async function loadUsers(
  client: PoolClient | Pool,
  ids: number[]
): Promise<Map<number, { id: number; handle: string }>> {
  if (ids.length === 0) return new Map();
  const result = await client.query<{ id: number; handle: string }>(
    `SELECT id, handle FROM users WHERE id = ANY($1::int[])`,
    [ids]
  );
  return new Map(result.rows.map((row) => [row.id, { id: row.id, handle: row.handle }]));
}

export async function friendState(
  client: PoolClient | Pool,
  me: number,
  other: number
): Promise<FriendState> {
  if (me === other) return "none";
  if (await blockedBetween(client, me, other)) {
    const iBlock = await client.query("SELECT 1 FROM blocks WHERE blocker = $1 AND blocked = $2", [me, other]);
    return iBlock.rows[0] ? "blocked" : "blocked_by";
  }
  if (await areFriends(client, me, other)) return "friends";
  const out = await client.query("SELECT 1 FROM friend_requests WHERE from_user = $1 AND to_user = $2", [me, other]);
  if (out.rows[0]) return "pending_out";
  const incoming = await client.query("SELECT 1 FROM friend_requests WHERE from_user = $1 AND to_user = $2", [other, me]);
  if (incoming.rows[0]) return "pending_in";
  return "none";
}

export async function listFriends(
  pool: Pool,
  me: number,
  presenceOf?: (userId: number) => Promise<"offline" | "online" | "in_party" | "in_match">
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const friendRows = await client.query<{ user_a: number; user_b: number; since: Date }>(
      `SELECT user_a, user_b, since FROM friendships WHERE user_a = $1 OR user_b = $1`,
      [me]
    );
    const friendIds = friendRows.rows.map((row) => (row.user_a === me ? row.user_b : row.user_a));
    const incoming = await client.query<FriendRequestRow>(
      "SELECT id, from_user, to_user, sent_at FROM friend_requests WHERE to_user = $1 ORDER BY id",
      [me]
    );
    const outgoing = await client.query<FriendRequestRow>(
      "SELECT id, from_user, to_user, sent_at FROM friend_requests WHERE from_user = $1 ORDER BY id",
      [me]
    );
    const blocked = await client.query<{ blocked: number }>("SELECT blocked FROM blocks WHERE blocker = $1 ORDER BY blocked", [me]);
    const ids = [...friendIds, ...incoming.rows.map((r) => r.from_user), ...outgoing.rows.map((r) => r.to_user), ...blocked.rows.map((r) => r.blocked)];
    const users = await loadUsers(client, ids);
    await client.query("COMMIT");
    const friends = await Promise.all(
      friendRows.rows.map(async (row) => {
        const friendId = row.user_a === me ? row.user_b : row.user_a;
        return {
          user: toUserPublic(users.get(friendId) ?? { id: 0, handle: "?" }),
          presence: presenceOf ? await presenceOf(friendId) : ("offline" as const),
          since: row.since.toISOString()
        };
      })
    );
    return {
      friends: friends.sort((a, b) => a.user.handle.localeCompare(b.user.handle)),
      incoming: incoming.rows.map((row) => ({
        id: row.id,
        from: toUserPublic(users.get(row.from_user) ?? { id: 0, handle: "?" }),
        sentAt: row.sent_at.toISOString()
      })),
      outgoing: outgoing.rows.map((row) => ({
        id: row.id,
        to: toUserPublic(users.get(row.to_user) ?? { id: 0, handle: "?" }),
        sentAt: row.sent_at.toISOString()
      })),
      blocked: blocked.rows.map((row) => toUserPublic(users.get(row.blocked) ?? { id: 0, handle: "?" }))
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function sendFriendRequest(
  pool: Pool,
  me: number,
  rawHandle: string
): Promise<
  | { kind: "created"; request: { id: number; to: UserPublic; status: "pending"; sentAt: string } }
  | { kind: "replay"; request: { id: number; to: UserPublic; status: "pending"; sentAt: string } }
  | { kind: "merged"; friendship: { user: UserPublic; status: "accepted"; since: string } }
> {
  const handle = rawHandle.trim().toLowerCase();
  return serializable(pool, async (client) => {
    const target = await client.query<{ id: number; handle: string }>(
      "SELECT id, handle FROM users WHERE handle_lower = $1",
      [handle]
    );
    const targetRow = target.rows[0];
    if (!targetRow) throw new ApiError(404, "user_not_found", "No player called that.");
    if (targetRow.id === me) {
      throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { handle: FIELD_MESSAGES.handleSelf });
    }
    if (await blockedBetween(client, me, targetRow.id)) throw new ApiError(403, "blocked", "You can't add this player.");
    if (await areFriends(client, me, targetRow.id)) {
      throw new ApiError(409, "already_friends", `You're already friends with ${targetRow.handle}.`);
    }
    // A crossed request accepts the other player's pending request instead.
    const crossed = await client.query<FriendRequestRow>(
      "SELECT id, from_user, to_user, sent_at FROM friend_requests WHERE from_user = $1 AND to_user = $2",
      [targetRow.id, me]
    );
    const crossedRow = crossed.rows[0];
    if (crossedRow) {
      await client.query("DELETE FROM friend_requests WHERE id = $1", [crossedRow.id]);
      const since = new Date();
      await client.query("INSERT INTO friendships (user_a, user_b, since) VALUES ($1, $2, $3)", [
        Math.min(me, targetRow.id),
        Math.max(me, targetRow.id),
        since
      ]);
      return {
        kind: "merged",
        friendship: {
          user: toUserPublic({ id: targetRow.id, handle: targetRow.handle }),
          status: "accepted",
          since: since.toISOString()
        }
      };
    }
    const existing = await client.query<FriendRequestRow>(
      "SELECT id, from_user, to_user, sent_at FROM friend_requests WHERE from_user = $1 AND to_user = $2",
      [me, targetRow.id]
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      return {
        kind: "replay",
        request: {
          id: existingRow.id,
          to: toUserPublic({ id: targetRow.id, handle: targetRow.handle }),
          status: "pending",
          sentAt: existingRow.sent_at.toISOString()
        }
      };
    }
    const inserted = await client.query<{ id: number; sent_at: Date }>(
      "INSERT INTO friend_requests (from_user, to_user) VALUES ($1, $2) RETURNING id, sent_at",
      [me, targetRow.id]
    );
    const row = inserted.rows[0];
    if (!row) throw err("server_error");
    return {
      kind: "created",
      request: {
        id: row.id,
        to: toUserPublic({ id: targetRow.id, handle: targetRow.handle }),
        status: "pending",
        sentAt: row.sent_at.toISOString()
      }
    };
  });
}

export async function acceptFriendRequest(pool: Pool, me: number, requestId: number): Promise<{ user: UserPublic; since: string }> {
  return serializable(pool, async (client) => {
    const found = await client.query<FriendRequestRow>(
      "SELECT id, from_user, to_user, sent_at FROM friend_requests WHERE id = $1 AND to_user = $2",
      [requestId, me]
    );
    const row = found.rows[0];
    if (!row) throw new ApiError(404, "request_not_found", "That request is no longer open.");
    await client.query("DELETE FROM friend_requests WHERE id = $1", [row.id]);
    const since = new Date();
    await client.query(
      "INSERT INTO friendships (user_a, user_b, since) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [Math.min(me, row.from_user), Math.max(me, row.from_user), since]
    );
    const user = await client.query<{ id: number; handle: string }>("SELECT id, handle FROM users WHERE id = $1", [row.from_user]);
    const userRow = user.rows[0];
    if (!userRow) throw err("server_error");
    return { user: toUserPublic({ id: userRow.id, handle: userRow.handle }), since: since.toISOString() };
  });
}

export async function declineFriendRequest(pool: Pool, me: number, requestId: number): Promise<void> {
  const result = await pool.query("DELETE FROM friend_requests WHERE id = $1 AND to_user = $2 RETURNING id", [requestId, me]);
  if (!result.rows[0]) throw new ApiError(404, "request_not_found", "That request is no longer open.");
}

export async function withdrawFriendRequest(pool: Pool, me: number, requestId: number): Promise<void> {
  const result = await pool.query("DELETE FROM friend_requests WHERE id = $1 AND from_user = $2 RETURNING id", [requestId, me]);
  if (!result.rows[0]) throw new ApiError(404, "request_not_found", "That request is no longer open.");
}

export async function removeFriend(pool: Pool, me: number, userId: number): Promise<void> {
  const lo = Math.min(me, userId);
  const hi = Math.max(me, userId);
  const result = await pool.query("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2 RETURNING user_a", [lo, hi]);
  if (!result.rows[0]) throw new ApiError(404, "not_friends", "You're not friends with that player.");
}

export async function blockPlayer(
  pool: Pool,
  me: number,
  userId: number
): Promise<{ user: UserPublic; blocked: boolean }> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new ApiError(404, "user_not_found", "No player called that.");
  }
  if (userId === me) {
    throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { userId: "You can't block yourself." });
  }
  const target = await pool.query<{ id: number; handle: string }>("SELECT id, handle FROM users WHERE id = $1", [userId]);
  const targetRow = target.rows[0];
  if (!targetRow) throw new ApiError(404, "user_not_found", "No player called that.");
  return serializable(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [Math.min(me, userId), Math.max(me, userId)]);
    const existing = await client.query("SELECT 1 FROM blocks WHERE blocker = $1 AND blocked = $2", [me, userId]);
    const already = Boolean(existing.rows[0]);
    if (!already) {
      await client.query("INSERT INTO blocks (blocker, blocked) VALUES ($1, $2)", [me, userId]);
    }
    const lo = Math.min(me, userId);
    const hi = Math.max(me, userId);
    await client.query("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2", [lo, hi]);
    await client.query("DELETE FROM friend_requests WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)", [
      me,
      userId
    ]);
    await client.query(
      `DELETE FROM party_invites pi
        USING parties p
        WHERE pi.party_id = p.id
          AND ((p.leader_id = $1 AND pi.to_user = $2) OR (p.leader_id = $2 AND pi.to_user = $1))`,
      [me, userId]
    );
    return {
      user: toUserPublic({ id: targetRow.id, handle: targetRow.handle }),
      blocked: !already
    };
  });
}

export async function unblockPlayer(pool: Pool, me: number, userId: number): Promise<void> {
  const result = await pool.query("DELETE FROM blocks WHERE blocker = $1 AND blocked = $2 RETURNING blocker", [me, userId]);
  if (!result.rows[0]) throw new ApiError(404, "not_blocked", "That player isn't blocked.");
}

/** Cancels every pending party invite whose sender is no longer a leader. */
export async function cancelInvitesFromNonLeaders(client: PoolClient): Promise<void> {
  await client.query(
    `UPDATE party_invites pi
        SET state = 'cancelled'
        FROM parties p
       WHERE pi.state = 'open' AND pi.party_id = p.id AND p.leader_id <> pi.from_user`
  );
  await client.query(
    `UPDATE party_invites pi SET state = 'cancelled' FROM parties p
      WHERE pi.state = 'open' AND pi.party_id = p.id AND p.leader_id = pi.from_user
        AND NOT EXISTS (SELECT 1 FROM party_members m WHERE m.party_id = p.id AND m.user_id = pi.from_user)`
  );
}
