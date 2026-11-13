import type { Pool, PoolClient } from "pg";
import type { Party, PartyState, UserPublic } from "../../shared/domain.js";
import { ApiError, err, serializable } from "../http.js";
import { areFriends, blockedBetween, createSoloParty } from "../db/users.js";
import { toUserPublic } from "../db/public.js";
import { cancelInvitesFromNonLeaders } from "./friends.js";

export type PartyRow = {
  id: number;
  state: PartyState;
  leader_id: number;
  lobby_id: number | null;
  match_id: number | null;
  queued_at: Date | null;
};

export type MemberRow = { user_id: number; joined_at: Date; handle: string };

export async function loadParty(client: PoolClient | Pool, partyId: number): Promise<Party | null> {
  const partyResult = await client.query<PartyRow>("SELECT id, state, leader_id, lobby_id, match_id, queued_at FROM parties WHERE id = $1", [partyId]);
  const partyRow = partyResult.rows[0];
  if (!partyRow) return null;
  const members = await client.query<MemberRow>(
    `SELECT m.user_id, m.joined_at, u.handle
       FROM party_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.party_id = $1
      ORDER BY m.joined_at, m.user_id`,
    [partyId]
  );
  return {
    id: partyRow.id,
    state: partyRow.state,
    leaderId: partyRow.leader_id,
    members: members.rows.map((row) => ({
      user: toUserPublic({ id: row.user_id, handle: row.handle }),
      joinedAt: row.joined_at.toISOString()
    })),
    lobbyId: partyRow.lobby_id,
    matchId: partyRow.match_id,
    queuedAt: partyRow.queued_at ? partyRow.queued_at.toISOString() : null
  };
}

export async function partyOfUser(client: PoolClient | Pool, userId: number): Promise<Party | null> {
  const found = await client.query<{ id: number }>(
    "SELECT p.id FROM parties p JOIN party_members m ON m.party_id = p.id WHERE m.user_id = $1",
    [userId]
  );
  const row = found.rows[0];
  return row ? loadParty(client, row.id) : null;
}

export type LobbySeatRow = { seat: number; user_id: number; party_id: number; seated_at: Date };

export type LobbyRow = {
  id: number;
  state: "filling" | "countdown" | "running" | "finished";
  countdown_ends_at: Date | null;
  match_id: number | null;
};

export type LobbyView = {
  lobby: {
    id: number;
    state: "filling" | "countdown" | "running" | "finished";
    size: 12;
    seats: { seat: number; userId: number; partyId: number; seatedAt: string }[];
    countdownEndsAt: string | null;
    matchId: number | null;
  };
};

export async function loadLobby(client: PoolClient | Pool, lobbyId: number): Promise<LobbyView | null> {
  const lobbyResult = await client.query<LobbyRow>(
    "SELECT id, state, countdown_ends_at, match_id FROM lobbies WHERE id = $1",
    [lobbyId]
  );
  const lobbyRow = lobbyResult.rows[0];
  if (!lobbyRow) return null;
  const seats = await client.query<LobbySeatRow>(
    "SELECT seat, user_id, party_id, seated_at FROM lobby_seats WHERE lobby_id = $1 ORDER BY seat",
    [lobbyId]
  );
  return {
    lobby: {
      id: lobbyRow.id,
      state: lobbyRow.state,
      size: 12,
      seats: seats.rows.map((row) => ({
        seat: row.seat,
        userId: row.user_id,
        partyId: row.party_id,
        seatedAt: row.seated_at.toISOString()
      })),
      countdownEndsAt: lobbyRow.countdown_ends_at ? lobbyRow.countdown_ends_at.toISOString() : null,
      matchId: lobbyRow.match_id
    }
  };
}

/** Leadership passes to the member who joined earliest, ties by lower user id. */
async function succession(client: PoolClient, partyId: number): Promise<void> {
  const next = await client.query<{ user_id: number }>(
    `SELECT user_id FROM party_members WHERE party_id = $1
      ORDER BY joined_at, user_id
      LIMIT 1`,
    [partyId]
  );
  const row = next.rows[0];
  if (row) {
    await client.query("UPDATE parties SET leader_id = $1 WHERE id = $2", [row.user_id, partyId]);
    await client.query(
      `UPDATE party_invites pi SET state = 'cancelled'
         FROM parties p
        WHERE pi.party_id = p.id AND p.id = $1 AND pi.from_user = $2`,
      [partyId, row.user_id]
    );
  }
}

export async function inviteToParty(
  pool: Pool,
  me: number,
  userId: number
): Promise<{ invite: { id: number; to: UserPublic; sentAt: string }; replay: boolean }> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new ApiError(404, "user_not_found", "No player called that.");
  }
  return serializable(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [userId]);
    const party = await partyOfUser(client, me);
    if (!party || party.leaderId !== me) throw new ApiError(403, "not_leader", "Only the party leader can do that.");
    if (party.members.some((m) => m.user.id === userId)) {
      throw new ApiError(409, "already_in_party", "That player is already in your party.");
    }
    if (party.members.length >= 4) throw new ApiError(409, "party_full", "That party is full.");
    if (party.state !== "idle") throw new ApiError(409, "party_busy", "That party is busy right now. Try again after its search or match.");
    if (me === userId) throw new ApiError(409, "already_in_party", "That player is already in your party.");
    if (!(await areFriends(client, me, userId)) || (await blockedBetween(client, me, userId))) {
      throw new ApiError(403, "not_friends", "You can only invite friends.");
    }
    const targetParty = await partyOfUser(client, userId);
    if (targetParty && targetParty.state !== "idle") {
      throw new ApiError(409, "party_busy", "That party is busy right now. Try again after its search or match.");
    }
    const existing = await client.query<{ id: number; sent_at: Date }>(
      `SELECT pi.id, pi.sent_at FROM party_invites pi
        JOIN parties p ON p.id = pi.party_id
       WHERE pi.state = 'open' AND pi.to_user = $1 AND p.leader_id = $2`,
      [userId, me]
    );
    const existingRow = existing.rows[0];
    const target = await client.query<{ handle: string }>("SELECT handle FROM users WHERE id = $1", [userId]);
    const targetHandle = target.rows[0]?.handle ?? "?";
    if (existingRow) {
      return {
        invite: { id: existingRow.id, to: toUserPublic({ id: userId, handle: targetHandle }), sentAt: existingRow.sent_at.toISOString() },
        replay: true
      };
    }
    const inserted = await client.query<{ id: number; sent_at: Date }>(
      "INSERT INTO party_invites (from_user, to_user, party_id) VALUES ($1, $2, $3) RETURNING id, sent_at",
      [me, userId, party.id]
    );
    const row = inserted.rows[0];
    if (!row) throw err("server_error");
    return {
      invite: { id: row.id, to: toUserPublic({ id: userId, handle: targetHandle }), sentAt: row.sent_at.toISOString() },
      replay: false
    };
  });
}

export async function acceptInvite(pool: Pool, me: number, inviteId: number): Promise<Party> {
  return serializable(pool, async (client) => {
    const invite = await client.query<{ id: number; from_user: number; party_id: number }>(
      `SELECT pi.id, pi.from_user, pi.party_id FROM party_invites pi
        JOIN parties p ON p.id = pi.party_id
       WHERE pi.id = $1 AND pi.to_user = $2 AND pi.state = 'open' AND p.leader_id = pi.from_user`,
      [inviteId, me]
    );
    const inviteRow = invite.rows[0];
    if (!inviteRow) throw new ApiError(404, "invite_not_found", "That invite is no longer open.");

    const targetParty = await loadParty(client, inviteRow.party_id);
    if (!targetParty) throw new ApiError(404, "invite_not_found", "That invite is no longer open.");
    if (targetParty.state !== "idle") throw new ApiError(409, "party_busy", "That party is busy right now. Try again after its search or match.");
    if (targetParty.members.length >= 4) throw new ApiError(409, "party_full", "That party is full.");

    const myParty = await partyOfUser(client, me);
    if (myParty && myParty.state !== "idle") throw new ApiError(409, "party_busy", "That party is busy right now. Try again after its search or match.");
    if (myParty && myParty.id !== inviteRow.party_id) {
      await client.query("DELETE FROM party_members WHERE party_id = $1 AND user_id = $2", [myParty.id, me]);
      await client.query(
        "UPDATE party_invites pi SET state = 'cancelled' FROM parties p WHERE pi.party_id = p.id AND p.id = $1 AND pi.from_user = $2",
        [myParty.id, me]
      );
      await client.query(`DELETE FROM parties WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM party_members m WHERE m.party_id = parties.id)`, [
        myParty.id
      ]);
      await succession(client, myParty.id);
    }
    await client.query("INSERT INTO party_members (party_id, user_id) VALUES ($1, $2)", [inviteRow.party_id, me]);
    await client.query("UPDATE party_invites SET state = 'joined' WHERE id = $1", [inviteRow.id]);
    const party = await loadParty(client, inviteRow.party_id);
    if (!party) throw err("server_error");
    return party;
  });
}

export async function declineInvite(pool: Pool, me: number, inviteId: number): Promise<void> {
  const result = await pool.query(
    `UPDATE party_invites pi SET state = 'declined' FROM parties p
      WHERE pi.id = $1 AND pi.to_user = $2 AND pi.state = 'open' AND p.leader_id = pi.from_user
      RETURNING pi.id`,
    [inviteId, me]
  );
  if (!result.rows[0]) throw new ApiError(404, "invite_not_found", "That invite is no longer open.");
}

export async function listInvites(pool: Pool, me: number): Promise<{
  incoming: { id: number; from: UserPublic; partyId: number; sentAt: string }[];
  outgoing: { id: number; to: UserPublic; sentAt: string }[];
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await cancelInvitesFromNonLeaders(client);
    const incoming = await client.query<{ id: number; from_user: number; party_id: number; sent_at: Date; handle: string }>(
      `SELECT pi.id, pi.from_user, pi.party_id, pi.sent_at, u.handle
         FROM party_invites pi
         JOIN parties p ON p.id = pi.party_id
         JOIN users u ON u.id = pi.from_user
        WHERE pi.to_user = $1 AND pi.state = 'open' AND p.leader_id = pi.from_user
        ORDER BY pi.id`,
      [me]
    );
    const outgoing = await client.query<{ id: number; to_user: number; sent_at: Date; handle: string }>(
      `SELECT pi.id, pi.to_user, pi.sent_at, u.handle
         FROM party_invites pi
         JOIN parties p ON p.id = pi.party_id
         JOIN users u ON u.id = pi.to_user
        WHERE p.leader_id = $1 AND pi.state = 'open'
        ORDER BY pi.id`,
      [me]
    );
    await client.query("COMMIT");
    return {
      incoming: incoming.rows.map((row) => ({
        id: row.id,
        from: toUserPublic({ id: row.from_user, handle: row.handle }),
        partyId: row.party_id,
        sentAt: row.sent_at.toISOString()
      })),
      outgoing: outgoing.rows.map((row) => ({
        id: row.id,
        to: toUserPublic({ id: row.to_user, handle: row.handle }),
        sentAt: row.sent_at.toISOString()
      }))
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function leaveParty(pool: Pool, me: number): Promise<Party> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const party = await partyOfUser(client, me);
    if (!party) throw err("server_error");
    if (party.members.length <= 1) throw new ApiError(409, "already_solo", "You're already on your own.");
    if (party.state === "in_match") throw new ApiError(409, "party_busy", "You can't leave during a match.");
    await client.query("DELETE FROM party_members WHERE party_id = $1 AND user_id = $2", [party.id, me]);
    await client.query("UPDATE party_invites pi SET state = 'cancelled' FROM parties p WHERE pi.party_id = p.id AND p.id = $1 AND pi.from_user = $2", [
      party.id,
      me
    ]);
    await client.query(`DELETE FROM parties WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM party_members m WHERE m.party_id = parties.id)`, [party.id]);

    if (party.state === "in_lobby") {
      await client.query("DELETE FROM lobby_seats WHERE user_id = $1", [me]);
      // A freed seat cancels the countdown and reopens the seat.
      await client.query(
        `UPDATE lobbies SET state = 'filling', countdown_ends_at = NULL
          WHERE id = $1 AND state = 'countdown'`,
        [party.lobbyId]
      );
    }
    if (party.state === "queued") {
      await client.query("UPDATE parties SET state = 'idle', queued_at = NULL WHERE id = $1", [party.id]);
    }
    await succession(client, party.id);
    const newPartyId = await createSoloParty(client, me);
    const newParty = await loadParty(client, newPartyId);
    await client.query("COMMIT");
    if (!newParty) throw err("server_error");
    return newParty;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function handOverLeadership(pool: Pool, me: number, userId: number): Promise<Party> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const party = await partyOfUser(client, me);
    if (!party) throw err("server_error");
    if (party.leaderId !== me) throw new ApiError(403, "not_leader", "Only the party leader can do that.");
    if (!party.members.some((m) => m.user.id === userId)) {
      throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { userId: "That player isn't in your party." });
    }
    await client.query("UPDATE parties SET leader_id = $1 WHERE id = $2", [userId, party.id]);
    await client.query(
      "UPDATE party_invites pi SET state = 'cancelled' FROM parties p WHERE pi.party_id = p.id AND p.id = $1 AND pi.from_user = $2",
      [party.id, me]
    );
    const updated = await loadParty(client, party.id);
    await client.query("COMMIT");
    if (!updated) throw err("server_error");
    return updated;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function queueParty(pool: Pool, me: number): Promise<Party> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const party = await partyOfUser(client, me);
    if (!party) throw err("server_error");
    if (party.leaderId !== me) throw new ApiError(403, "not_leader", "Only the party leader can do that.");
    if (party.state !== "idle") {
      throw new ApiError(409, "invalid_transition", "Your party is already searching or playing.", { state: party.state });
    }
    await client.query("UPDATE parties SET state = 'queued', queued_at = $1 WHERE id = $2", [new Date(), party.id]);
    const updated = await loadParty(client, party.id);
    await client.query("COMMIT");
    if (!updated) throw err("server_error");
    return updated;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelQueue(pool: Pool, me: number): Promise<Party> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const party = await partyOfUser(client, me);
    if (!party) throw err("server_error");
    if (party.leaderId !== me) throw new ApiError(403, "not_leader", "Only the party leader can do that.");
    if (party.state !== "queued") {
      throw new ApiError(409, "invalid_transition", "Your party isn't searching any more.", { state: party.state });
    }
    await client.query("UPDATE parties SET state = 'idle', queued_at = NULL WHERE id = $1", [party.id]);
    const updated = await loadParty(client, party.id);
    await client.query("COMMIT");
    if (!updated) throw err("server_error");
    return updated;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function leaveLobby(pool: Pool, me: number): Promise<Party> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const party = await partyOfUser(client, me);
    if (!party) throw err("server_error");
    if (party.leaderId !== me) throw new ApiError(403, "not_leader", "Only the party leader can do that.");
    if (party.state !== "in_lobby") {
      throw new ApiError(409, "invalid_transition", "Your party isn't in a lobby.", { state: party.state });
    }
    await client.query("DELETE FROM lobby_seats WHERE party_id = $1", [party.id]);
    await client.query("UPDATE parties SET state = 'idle', lobby_id = NULL, queued_at = NULL WHERE id = $1", [party.id]);
    const lobby = await loadLobby(client, party.lobbyId ?? 0);
    if (lobby) {
      if (lobby.lobby.state === "countdown") {
        await client.query("UPDATE lobbies SET state = 'filling', countdown_ends_at = NULL WHERE id = $1", [lobby.lobby.id]);
      }
    }
    const updated = await loadParty(client, party.id);
    await client.query("COMMIT");
    if (!updated) throw err("server_error");
    return updated;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
