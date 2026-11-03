// Parties: membership, leadership with succession, invites and the party state machine.
import type pg from "pg";
import { emit, LOCK, lockKey, one, type Queryable, query, transaction } from "./db.js";
import { ApiError, FIELD_COPY, fieldError, transitionError } from "./errors.js";
import { route } from "./http.js";
import { instanceId } from "./instance.js";
import { freeSeats } from "./lobby.js";
import { positiveId } from "./matches.js";
import { areFriends, blockBetween, iso, lockPair, toUser, usersById } from "./users.js";
import type { Invites, Party } from "../shared/api.js";
import { PARTY_MAX, type PartyState } from "../shared/rules.js";


interface PartyRow {
  id: number;
  state: PartyState;
  leader_id: number;
  lobby_id: number | null;
  match_id: number | null;
  queued_at: Date | null;
}

export async function loadParty(partyId: number, on?: Queryable): Promise<Party> {
  const party = await one<PartyRow>("SELECT id, state, leader_id, lobby_id, match_id, queued_at FROM parties WHERE id = $1", [partyId], on);
  if (party === undefined) throw new Error(`party ${partyId} missing`);
  const members = await query(
    `SELECT u.id, u.handle, m.joined_at FROM party_members m JOIN users u ON u.id = m.user_id
     WHERE m.party_id = $1 ORDER BY m.joined_at, u.id`, [partyId], on);
  return {
    id: party.id,
    state: party.state,
    leaderId: party.leader_id,
    members: members.map((row) => ({ user: toUser(row), joinedAt: iso(row["joined_at"]) })),
    lobbyId: party.lobby_id,
    matchId: party.match_id,
    queuedAt: party.queued_at === null ? null : iso(party.queued_at),
  };
}

export async function partyIdOf(userId: number, on?: Queryable): Promise<number> {
  const row = await one<{ party_id: number }>("SELECT party_id FROM party_members WHERE user_id = $1", [userId], on);
  if (row === undefined) throw new Error(`user ${userId} has no party`);
  return row.party_id;
}

async function lockParties(client: pg.PoolClient, ids: number[]): Promise<Map<number, PartyRow>> {
  const rows = await query<PartyRow>(
    "SELECT id, state, leader_id, lobby_id, match_id, queued_at FROM parties WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE",
    [ids], client);
  return new Map(rows.map((row) => [row.id, row]));
}

// Locks the caller's party row; the membership is re-read under the lock so concurrent moves can't slip past.
async function lockOwnParty(client: pg.PoolClient, userId: number): Promise<PartyRow> {
  for (;;) {
    const partyId = await partyIdOf(userId, client);
    const party = (await lockParties(client, [partyId])).get(partyId);
    if (party !== undefined && (await partyIdOf(userId, client)) === partyId) return party;
  }
}

async function memberCount(partyId: number, on: Queryable): Promise<number> {
  const row = await one<{ n: number }>("SELECT count(*)::int AS n FROM party_members WHERE party_id = $1", [partyId], on);
  return row?.n ?? 0;
}

export async function startSoloParty(client: pg.PoolClient, userId: number): Promise<number> {
  const party = await one<{ id: number }>(
    "INSERT INTO parties (state, leader_id, created_at) VALUES ('idle', $1, $2) RETURNING id", [userId, new Date()], client);
  if (party === undefined) throw new Error("party not stored");
  await query(
    `INSERT INTO party_members (user_id, party_id, joined_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET party_id = EXCLUDED.party_id, joined_at = EXCLUDED.joined_at`,
    [userId, party.id, new Date()], client);
  await emit(client, { kind: "party", partyId: party.id });
  return party.id;
}

async function cancelInvitesFrom(client: pg.PoolClient, userId: number): Promise<void> {
  const cancelled = await query("DELETE FROM party_invites WHERE from_id = $1 RETURNING to_id", [userId], client);
  for (const row of cancelled) await emit(client, { kind: "invites", userId: Number(row["to_id"]) });
  if (cancelled.length > 0) await emit(client, { kind: "invites", userId });
}

// Takes a member out of a party: their seat goes, the search stops, and leadership passes to the longest-standing member.
async function removeMember(client: pg.PoolClient, party: PartyRow, userId: number): Promise<void> {
  await query("DELETE FROM party_members WHERE user_id = $1 AND party_id = $2", [userId, party.id], client);
  await cancelInvitesFrom(client, userId);
  const heir = await one<{ user_id: number }>(
    "SELECT user_id FROM party_members WHERE party_id = $1 ORDER BY joined_at, user_id LIMIT 1", [party.id], client);
  if (heir !== undefined && party.leader_id === userId) {
    await query("UPDATE parties SET leader_id = $1 WHERE id = $2", [heir.user_id, party.id], client);
  }
  if (party.state === "queued") {
    await query("UPDATE parties SET state = 'idle', queued_at = NULL, queued_via = NULL WHERE id = $1", [party.id], client);
  }
  if (party.state === "in_lobby" && party.lobby_id !== null) await freeSeats(client, party.lobby_id, [userId]);
  await emit(client, { kind: "party", partyId: party.id });
}

async function invitesFor(userId: number, on?: Queryable): Promise<Invites> {
  const incoming = await query(
    `SELECT i.id, i.party_id, i.sent_at, u.id AS from_id, u.handle AS from_handle FROM party_invites i
     JOIN users u ON u.id = i.from_id WHERE i.to_id = $1 ORDER BY i.sent_at, i.id`, [userId], on);
  const outgoing = await query(
    `SELECT i.id, i.sent_at, u.id AS to_id, u.handle AS to_handle FROM party_invites i
     JOIN users u ON u.id = i.to_id WHERE i.from_id = $1 ORDER BY i.sent_at, i.id`, [userId], on);
  return {
    incoming: incoming.map((row) => ({
      id: Number(row["id"]), from: toUser(row, "from_"), partyId: Number(row["party_id"]), sentAt: iso(row["sent_at"]),
    })),
    outgoing: outgoing.map((row) => ({ id: Number(row["id"]), to: toUser(row, "to_"), sentAt: iso(row["sent_at"]) })),
  };
}

route("GET", "/api/party", "verified", async ({ me }) => ({
  status: 200,
  body: { party: await loadParty(await partyIdOf(me.id)), invites: await invitesFor(me.id) },
}));

route("POST", "/api/party/invites", "verified", async ({ me, body }) => {
  const toId = positiveId(body["userId"]);
  const result = await transaction(async (client) => {
    const party = await lockOwnParty(client, me.id);
    if (party.leader_id !== me.id) throw new ApiError("not_leader");
    if (toId !== 0) await lockPair(client, me.id, toId);
    if (toId === 0 || !(await areFriends(me.id, toId, client)) || (await blockBetween(me.id, toId, client))) {
      throw new ApiError("not_friends");
    }
    if ((await partyIdOf(toId, client)) === party.id) throw new ApiError("already_in_party");
    if ((await memberCount(party.id, client)) >= PARTY_MAX) throw new ApiError("party_full");
    if (party.state !== "idle") throw new ApiError("party_busy");
    const existing = await one("SELECT id, sent_at FROM party_invites WHERE party_id = $1 AND to_id = $2 AND from_id = $3",
      [party.id, toId, me.id], client);
    if (existing !== undefined) return { status: 200, row: existing };
    const row = await one("INSERT INTO party_invites (party_id, from_id, to_id, sent_at) VALUES ($1, $2, $3, $4) RETURNING id, sent_at",
      [party.id, me.id, toId, new Date()], client);
    await emit(client, { kind: "invites", userId: toId });
    await emit(client, { kind: "invites", userId: me.id });
    return { status: 201, row };
  });
  const to = (await usersById([toId])).get(toId);
  return {
    status: result.status,
    body: { invite: { id: Number(result.row?.["id"]), to, sentAt: iso(result.row?.["sent_at"]) } },
  };
});

route("POST", "/api/party/invites/:id/accept", "verified", async ({ me, params }) => {
  const inviteId = positiveId(params[0]);
  const partyId = await transaction(async (client) => {
    const invite = await one<{ party_id: number; from_id: number }>(
      "SELECT party_id, from_id FROM party_invites WHERE id = $1 AND to_id = $2", [inviteId, me.id], client);
    if (invite === undefined) throw new ApiError("invite_not_found");
    const ownId = await partyIdOf(me.id, client);
    const locked = await lockParties(client, [ownId, invite.party_id]);
    const own = locked.get(ownId);
    const target = locked.get(invite.party_id);
    if (own === undefined || target === undefined || (await partyIdOf(me.id, client)) !== ownId) throw new ApiError("invite_not_found");
    if (ownId === target.id) throw new ApiError("invite_not_found");
    if ((await memberCount(target.id, client)) >= PARTY_MAX) throw new ApiError("party_full");
    if (own.state !== "idle" || target.state !== "idle") throw new ApiError("party_busy");
    // A block or a leader change may have cancelled the invite while this request waited for the party locks.
    if ((await one("DELETE FROM party_invites WHERE id = $1 RETURNING id", [inviteId], client)) === undefined) throw new ApiError("invite_not_found");
    await removeMember(client, own, me.id);
    await query("INSERT INTO party_members (user_id, party_id, joined_at) VALUES ($1, $2, $3)", [me.id, target.id, new Date()], client);
    await emit(client, { kind: "party", partyId: target.id });
    await emit(client, { kind: "invites", userId: me.id });
    await emit(client, { kind: "invites", userId: invite.from_id });
    return target.id;
  });
  return { status: 200, body: { party: await loadParty(partyId) } };
});

route("POST", "/api/party/invites/:id/decline", "verified", async ({ me, params }) => {
  const inviteId = positiveId(params[0]);
  await transaction(async (client) => {
    const row = await one<{ from_id: number }>("DELETE FROM party_invites WHERE id = $1 AND to_id = $2 RETURNING from_id",
      [inviteId, me.id], client);
    if (row === undefined) throw new ApiError("invite_not_found");
    await emit(client, { kind: "invites", userId: row.from_id });
    await emit(client, { kind: "invites", userId: me.id });
  });
  return { status: 204 };
});

route("POST", "/api/party/leave", "verified", async ({ me }) => {
  const partyId = await transaction(async (client) => {
    await lockKey(client, LOCK.seating, 0);
    const party = await lockOwnParty(client, me.id);
    if ((await memberCount(party.id, client)) === 1) throw new ApiError("already_solo");
    if (party.state === "in_match") throw new ApiError("party_busy");
    await removeMember(client, party, me.id);
    return startSoloParty(client, me.id);
  });
  return { status: 200, body: { party: await loadParty(partyId) } };
});

route("POST", "/api/party/leader", "verified", async ({ me, body }) => {
  const heirId = positiveId(body["userId"]);
  const partyId = await transaction(async (client) => {
    const party = await lockOwnParty(client, me.id);
    if (party.leader_id !== me.id) throw new ApiError("not_leader");
    const member = await one("SELECT 1 FROM party_members WHERE user_id = $1 AND party_id = $2", [heirId, party.id], client);
    if (member === undefined) {
      throw fieldError({ userId: FIELD_COPY.partyMember });
    }
    if (heirId !== me.id) {
      await query("UPDATE parties SET leader_id = $1 WHERE id = $2", [heirId, party.id], client);
      await cancelInvitesFrom(client, me.id);
      await emit(client, { kind: "party", partyId: party.id });
    }
    return party.id;
  });
  return { status: 200, body: { party: await loadParty(partyId) } };
});

async function leaderTransition(userId: number, from: PartyState,
  apply: (client: pg.PoolClient, party: PartyRow) => Promise<void>): Promise<Party> {
  const partyId = await transaction(async (client) => {
    await lockKey(client, LOCK.seating, 0);
    const party = await lockOwnParty(client, userId);
    if (party.leader_id !== userId) throw new ApiError("not_leader");
    if (party.state !== from) throw transitionError(party.state);
    await apply(client, party);
    await emit(client, { kind: "party", partyId: party.id });
    return party.id;
  });
  return loadParty(partyId);
}

route("POST", "/api/party/queue", "verified", async ({ me }) => ({
  status: 202,
  body: {
    party: await leaderTransition(me.id, "idle", async (client, party) => {
      await query("UPDATE parties SET state = 'queued', queued_at = clock_timestamp(), queued_via = $2 WHERE id = $1",
        [party.id, instanceId], client);
    }),
  },
}));

route("POST", "/api/party/queue/cancel", "verified", async ({ me }) => ({
  status: 200,
  body: {
    party: await leaderTransition(me.id, "queued", async (client, party) => {
      await query("UPDATE parties SET state = 'idle', queued_at = NULL, queued_via = NULL WHERE id = $1", [party.id], client);
    }),
  },
}));

route("POST", "/api/lobby/leave", "verified", async ({ me }) => ({
  status: 200,
  body: {
    party: await leaderTransition(me.id, "in_lobby", async (client, party) => {
      if (party.lobby_id !== null) {
        const members = await query("SELECT user_id FROM party_members WHERE party_id = $1", [party.id], client);
        await freeSeats(client, party.lobby_id, members.map((row) => Number(row["user_id"])));
      }
      await query("UPDATE parties SET state = 'idle', lobby_id = NULL WHERE id = $1", [party.id], client);
    }),
  },
}));
