import type { Pool } from "pg";
import { withTransaction } from "../http.js";
import { loadLobby, type LobbyView } from "./parties.js";

export type SeatingOutcome = {
  seated: boolean;
  lobbyId: number | null;
};

/**
 * Seats queued parties into lobbies. The database decides every placement:
 * each party row is locked with FOR UPDATE before its seats are taken, so
 * concurrent placements from any number of server processes queue up in
 * sequence and never overfill a lobby or split a party.
 */
export async function seatQueuedParties(pool: Pool): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const queued = await client.query<{ id: number }>(
      "SELECT id FROM parties WHERE state = 'queued' ORDER BY queued_at, id"
    );
    for (const party of queued.rows) {
      // Lock the party; another transaction seating it commits first and we
      // see its new state here instead of seating it twice.
      const locked = await client.query<{ state: string; leader_id: number }>(
        "SELECT state, leader_id FROM parties WHERE id = $1 FOR UPDATE",
        [party.id]
      );
      const partyRow = locked.rows[0];
      if (!partyRow || partyRow.state !== "queued") continue;

      const members = await client.query<{ user_id: number; joined_at: Date }>(
        "SELECT user_id, joined_at FROM party_members WHERE party_id = $1 ORDER BY joined_at, user_id",
        [party.id]
      );
      const size = members.rows.length;

      const lobbies = await client.query<{ id: number }>(
        `SELECT l.id FROM lobbies l
          WHERE l.state = 'filling'
          AND (SELECT count(*)::int FROM lobby_seats s WHERE s.lobby_id = l.id) + $1 <= 12
          ORDER BY l.created_at, l.id
          FOR UPDATE OF l`,
        [size]
      );
      let lobbyId = lobbies.rows[0]?.id;
      if (!lobbyId) {
        const created = await client.query<{ id: number }>(
          "INSERT INTO lobbies (state) VALUES ('filling') RETURNING id"
        );
        lobbyId = (created.rows[0] as { id: number }).id;
      }

      const seats = await client.query<{ seat: number }>(
        "SELECT seat FROM lobby_seats WHERE lobby_id = $1 ORDER BY seat",
        [lobbyId]
      );
      const taken = new Set(seats.rows.map((row) => row.seat));
      let seat = 1;
      for (const member of members.rows) {
        while (taken.has(seat)) seat += 1;
        await client.query("INSERT INTO lobby_seats (lobby_id, seat, user_id, party_id) VALUES ($1, $2, $3, $4)", [
          lobbyId,
          seat,
          member.user_id,
          party.id
        ]);
        taken.add(seat);
      }
      const count = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM lobby_seats WHERE lobby_id = $1",
        [lobbyId]
      );
      if ((count.rows[0] as { count: number }).count >= 12) {
        await client.query("UPDATE lobbies SET state = 'countdown', countdown_ends_at = $1 WHERE id = $2", [
          new Date(Date.now() + 10000),
          lobbyId
        ]);
      }
      await client.query("UPDATE parties SET state = 'in_lobby', lobby_id = $1, queued_at = NULL WHERE id = $2", [
        lobbyId,
        party.id
      ]);
    }
  }).catch(async (e: unknown) => {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("could not serialize access") || message.includes("deadlock")) return;
    throw e;
  });
}

/** Cancels a lobby countdown if any seat was freed, and returns the lobby. */
export async function refreshLobby(pool: Pool, lobbyId: number): Promise<LobbyView | null> {
  await withTransaction(pool, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const lobby = await client.query<{ id: number; state: string }>("SELECT id, state FROM lobbies WHERE id = $1 FOR UPDATE", [lobbyId]);
    const row = lobby.rows[0];
    if (!row) return;
    const count = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM lobby_seats WHERE lobby_id = $1", [lobbyId]);
    const seats = (count.rows[0] as { count: number }).count;
    if (row.state === "countdown" && seats < 12) {
      await client.query("UPDATE lobbies SET state = 'filling', countdown_ends_at = NULL WHERE id = $1", [lobbyId]);
    } else if (row.state === "filling" && seats >= 12) {
      await client.query("UPDATE lobbies SET state = 'countdown', countdown_ends_at = $1 WHERE id = $2", [
        new Date(Date.now() + 10000),
        lobbyId
      ]);
    }
  });
  return loadLobby(pool, lobbyId);
}
