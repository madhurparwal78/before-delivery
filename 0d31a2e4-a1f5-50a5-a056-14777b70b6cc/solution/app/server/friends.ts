// Friend requests, friendships, blocks and profiles.
import type pg from "pg";
import { emit, one, query, transaction } from "./db.js";
import { ApiError, FIELD_COPY, fieldError } from "./errors.js";
import { route } from "./http.js";
import { presenceFor } from "./hub.js";
import { positiveId } from "./matches.js";
import { areFriends, blockBetween, iso, lockPair, toUser, usersById } from "./users.js";
import type { User } from "../shared/api.js";
import { MATCH_HISTORY_SIZE, matchName, type PartyState, type Presence } from "../shared/rules.js";

async function befriend(client: pg.PoolClient, a: number, b: number): Promise<Date> {
  const since = new Date();
  await query("INSERT INTO friendships (low_id, high_id, since) VALUES (LEAST($1::int, $2::int), GREATEST($1::int, $2::int), $3) ON CONFLICT DO NOTHING",
    [a, b, since], client);
  await emit(client, { kind: "friends", userId: a });
  await emit(client, { kind: "friends", userId: b });
  return since;
}

// Presence of players as one viewer may see it: only accepted friends with no block either way.
async function presenceOfUsers(ids: number[]): Promise<Map<number, Presence>> {
  const rows = await query(
    `SELECT m.user_id, p.state, (SELECT count(*)::int FROM party_members x WHERE x.party_id = m.party_id) AS size
     FROM party_members m JOIN parties p ON p.id = m.party_id WHERE m.user_id = ANY($1::int[])`, [ids]);
  return new Map(rows.map((row) => [Number(row["user_id"]),
    presenceFor(Number(row["user_id"]), Number(row["size"]), row["state"] as PartyState)]));
}

route("GET", "/api/friends", "verified", async ({ me }) => {
  const friends = await query(
    `SELECT u.id, u.handle, f.since FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.low_id = $1 THEN f.high_id ELSE f.low_id END
     WHERE f.low_id = $1 OR f.high_id = $1 ORDER BY u.handle`, [me.id]);
  const presence = await presenceOfUsers(friends.map((row) => Number(row["id"])));
  const incoming = await query(
    "SELECT r.id, r.sent_at, u.id AS from_id, u.handle AS from_handle FROM friend_requests r JOIN users u ON u.id = r.from_id WHERE r.to_id = $1 ORDER BY r.sent_at, r.id", [me.id]);
  const outgoing = await query(
    "SELECT r.id, r.sent_at, u.id AS to_id, u.handle AS to_handle FROM friend_requests r JOIN users u ON u.id = r.to_id WHERE r.from_id = $1 ORDER BY r.sent_at, r.id", [me.id]);
  const blocked = await query("SELECT u.id, u.handle FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY u.handle", [me.id]);
  return {
    status: 200,
    body: {
      friends: friends.map((row) => ({
        user: toUser(row), presence: presence.get(Number(row["id"])) ?? "offline", since: iso(row["since"]),
      })),
      incoming: incoming.map((row) => ({ id: Number(row["id"]), from: toUser(row, "from_"), sentAt: iso(row["sent_at"]) })),
      outgoing: outgoing.map((row) => ({ id: Number(row["id"]), to: toUser(row, "to_"), sentAt: iso(row["sent_at"]) })),
      blocked: blocked.map((row) => toUser(row)),
    },
  };
});

route("POST", "/api/friends/requests", "verified", async ({ me, body }) => {
  const handle = typeof body["handle"] === "string" ? body["handle"].trim().toLowerCase() : "";
  if (handle === me.handle) throw fieldError({ handle: FIELD_COPY.ownHandle });
  const target = await one<{ id: number; handle: string }>("SELECT id, handle FROM users WHERE lower(handle) = $1", [handle]);
  if (target === undefined) throw new ApiError("user_not_found");
  const other: User = toUser(target);
  const outcome = await transaction(async (client) => {
    await lockPair(client, me.id, target.id);
    if (await blockBetween(me.id, target.id, client)) throw new ApiError("blocked");
    if (await areFriends(me.id, target.id, client)) throw new ApiError("already_friends");
    const reverse = await one<{ id: number }>("DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2 RETURNING id", [target.id, me.id], client);
    if (reverse !== undefined) return { merged: true as const, since: await befriend(client, me.id, target.id) };
    const existing = await one<{ id: number; sent_at: Date }>("SELECT id, sent_at FROM friend_requests WHERE from_id = $1 AND to_id = $2", [me.id, target.id], client);
    if (existing !== undefined) return { merged: false as const, status: 200, id: existing.id, sentAt: existing.sent_at };
    const created = await one<{ id: number; sent_at: Date }>(
      "INSERT INTO friend_requests (from_id, to_id, sent_at) VALUES ($1, $2, $3) RETURNING id, sent_at", [me.id, target.id, new Date()], client);
    if (created === undefined) throw new Error("request not stored");
    await emit(client, { kind: "friends", userId: target.id });
    await emit(client, { kind: "friends", userId: me.id });
    return { merged: false as const, status: 201, id: created.id, sentAt: created.sent_at };
  });
  if (outcome.merged) {
    return { status: 200, body: { friendship: { user: other, status: "accepted", since: iso(outcome.since) } } };
  }
  return { status: outcome.status, body: { request: { id: outcome.id, to: other, status: "pending", sentAt: iso(outcome.sentAt) } } };
});

function requestId(params: string[]): number {
  return positiveId(params[0]);
}

route("POST", "/api/friends/requests/:id/accept", "verified", async ({ me, params }) => {
  const id = requestId(params);
  const request = await one<{ from_id: number }>("SELECT from_id FROM friend_requests WHERE id = $1 AND to_id = $2", [id, me.id]);
  if (request === undefined) throw new ApiError("request_not_found");
  const since = await transaction(async (client) => {
    await lockPair(client, me.id, request.from_id);
    const removed = await one("DELETE FROM friend_requests WHERE id = $1 AND to_id = $2 RETURNING id", [id, me.id], client);
    if (removed === undefined) throw new ApiError("request_not_found");
    return befriend(client, me.id, request.from_id);
  });
  const user = (await usersById([request.from_id])).get(request.from_id);
  return { status: 200, body: { friendship: { user, status: "accepted", since: iso(since) } } };
});

async function dropRequest(sql: string, id: number, me: number): Promise<void> {
  await transaction(async (client) => {
    const removed = await one<{ from_id: number; to_id: number }>(sql, [id, me], client);
    if (removed === undefined) throw new ApiError("request_not_found");
    await emit(client, { kind: "friends", userId: removed.from_id });
    await emit(client, { kind: "friends", userId: removed.to_id });
  });
}

route("POST", "/api/friends/requests/:id/decline", "verified", async ({ me, params }) => {
  await dropRequest("DELETE FROM friend_requests WHERE id = $1 AND to_id = $2 RETURNING from_id, to_id", requestId(params), me.id);
  return { status: 204 };
});

route("DELETE", "/api/friends/requests/:id", "verified", async ({ me, params }) => {
  await dropRequest("DELETE FROM friend_requests WHERE id = $1 AND from_id = $2 RETURNING from_id, to_id", requestId(params), me.id);
  return { status: 204 };
});

route("DELETE", "/api/friends/:userId", "verified", async ({ me, params }) => {
  const other = positiveId(params[0]);
  await transaction(async (client) => {
    const removed = await one(
      "DELETE FROM friendships WHERE low_id = LEAST($1::int, $2::int) AND high_id = GREATEST($1::int, $2::int) RETURNING low_id", [me.id, other], client);
    if (removed === undefined) throw new ApiError("not_friends", {}, {}, 404);
    await emit(client, { kind: "friends", userId: me.id });
    await emit(client, { kind: "friends", userId: other });
  });
  return { status: 204 };
});

// A block cuts every link in one transaction: friendship, friend requests and party invites, both ways.
route("POST", "/api/blocks", "verified", async ({ me, body }) => {
  const targetId = positiveId(body["userId"]);
  if (targetId === me.id) throw fieldError({ userId: FIELD_COPY.ownUser });
  const target = (await usersById([targetId])).get(targetId);
  if (target === undefined) throw new ApiError("user_not_found");
  const created = await transaction(async (client) => {
    await lockPair(client, me.id, targetId);
    const inserted = await one("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING blocker_id",
      [me.id, targetId, new Date()], client);
    await query("DELETE FROM friendships WHERE low_id = LEAST($1::int, $2::int) AND high_id = GREATEST($1::int, $2::int)", [me.id, targetId], client);
    await query("DELETE FROM friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)", [me.id, targetId], client);
    await query("DELETE FROM party_invites WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)", [me.id, targetId], client);
    for (const userId of [me.id, targetId]) {
      await emit(client, { kind: "friends", userId });
      await emit(client, { kind: "invites", userId });
    }
    return inserted !== undefined;
  });
  return { status: created ? 201 : 200, body: { blocked: target } };
});

route("DELETE", "/api/blocks/:userId", "verified", async ({ me, params }) => {
  const other = positiveId(params[0]);
  await transaction(async (client) => {
    const removed = await one("DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2 RETURNING blocked_id", [me.id, other], client);
    if (removed === undefined) throw new ApiError("not_blocked");
    await emit(client, { kind: "friends", userId: me.id });
  });
  return { status: 204 };
});

type Friendship = "none" | "pending_in" | "pending_out" | "friends" | "blocked" | "blocked_by";

async function relationship(me: number, other: number): Promise<Friendship> {
  if (me === other) return "none";
  const blocks = await query("SELECT blocker_id FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)", [me, other]);
  if (blocks.some((row) => Number(row["blocker_id"]) === me)) return "blocked";
  if (blocks.length > 0) return "blocked_by";
  if (await areFriends(me, other)) return "friends";
  const request = await one<{ from_id: number }>(
    "SELECT from_id FROM friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)", [me, other]);
  if (request === undefined) return "none";
  return request.from_id === me ? "pending_out" : "pending_in";
}

route("GET", "/api/users/:handle", "session", async ({ me, params }) => {
  const row = await one("SELECT id, handle FROM users WHERE lower(handle) = $1", [(params[0] ?? "").toLowerCase()]);
  if (row === undefined) throw new ApiError("user_not_found");
  const user = toUser(row);
  const friendship = await relationship(me.id, user.id);
  const presence = friendship === "friends" ? (await presenceOfUsers([user.id])).get(user.id) ?? "offline" : null;
  const counts = await one<{ played: number; wins: number }>(
    `SELECT count(*)::int AS played, count(*) FILTER (WHERE m.winner_id = $1)::int AS wins
     FROM match_participants p JOIN matches m ON m.id = p.match_id WHERE p.user_id = $1 AND m.state = 'finished'`, [user.id]);
  const history = await query(
    `SELECT m.id, m.finished_at, m.winner_id,
       (SELECT r.n FROM round_results x JOIN rounds r ON r.id = x.round_id
         WHERE r.match_id = m.id AND x.user_id = $1 AND x.outcome = 'eliminated' ORDER BY r.n LIMIT 1) AS out_round
     FROM match_participants p JOIN matches m ON m.id = p.match_id
     WHERE p.user_id = $1 AND m.state = 'finished' ORDER BY m.finished_at DESC, m.id DESC LIMIT $2`, [user.id, MATCH_HISTORY_SIZE]);
  return {
    status: 200,
    body: {
      user,
      friendship,
      presence,
      played: counts?.played ?? 0,
      wins: counts?.wins ?? 0,
      matches: history.map((match) => {
        const winner = Number(match["winner_id"]) === user.id;
        const outRound = match["out_round"] === null ? null : Number(match["out_round"]);
        return {
          id: Number(match["id"]),
          name: matchName(Number(match["id"])),
          finishedAt: iso(match["finished_at"]),
          outcome: winner ? "winner" : "eliminated",
          round: winner ? null : outRound,
        };
      }),
    },
  };
});
