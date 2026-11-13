// Lobbies and seats. Seating runs under one database lock, so every process places parties whole and in queue order.
import type pg from "pg";
import { emit, LOCK, lockKey, one, type Queryable, query, transaction } from "./db.js";
import { ApiError } from "./errors.js";
import { route } from "./http.js";
import { instanceId } from "./instance.js";
import { positiveId } from "./matches.js";
import { iso } from "./users.js";
import type { Lobby } from "../shared/api.js";
import { COUNTDOWN_SECONDS, LOBBY_SIZE, type LobbyState } from "../shared/rules.js";


export async function loadLobby(lobbyId: number, on?: Queryable): Promise<Lobby | null> {
  const lobby = await one<{ id: number; state: LobbyState; countdown_ends_at: Date | null; match_id: number | null }>(
    "SELECT id, state, countdown_ends_at, match_id FROM lobbies WHERE id = $1", [lobbyId], on);
  if (lobby === undefined) return null;
  const seats = await query("SELECT seat, user_id, party_id, seated_at FROM seats WHERE lobby_id = $1 ORDER BY seat", [lobbyId], on);
  return {
    id: lobby.id,
    state: lobby.state,
    size: LOBBY_SIZE,
    seats: seats.map((row) => ({
      seat: Number(row["seat"]), userId: Number(row["user_id"]), partyId: Number(row["party_id"]), seatedAt: iso(row["seated_at"]),
    })),
    countdownEndsAt: lobby.countdown_ends_at === null ? null : iso(lobby.countdown_ends_at),
    matchId: lobby.match_id,
  };
}

// Frees seats; a lobby counting down goes back to filling and its countdown is cancelled.
export async function freeSeats(client: pg.PoolClient, lobbyId: number, userIds: number[]): Promise<void> {
  await query("SELECT id FROM lobbies WHERE id = $1 FOR UPDATE", [lobbyId], client);
  await query("DELETE FROM seats WHERE lobby_id = $1 AND user_id = ANY($2::int[])", [lobbyId, userIds], client);
  await query("UPDATE lobbies SET state = 'filling', countdown_ends_at = NULL WHERE id = $1 AND state = 'countdown'", [lobbyId], client);
  await emit(client, { kind: "lobby", lobbyId });
}

async function seatParty(client: pg.PoolClient, party: { id: number; queued_via: string | null }): Promise<void> {
  const members = (await query("SELECT user_id FROM party_members WHERE party_id = $1 ORDER BY joined_at, user_id", [party.id], client))
    .map((row) => Number(row["user_id"]));
  if (members.length === 0) return;
  let lobby = await one<{ id: number }>(
    `SELECT l.id FROM lobbies l WHERE l.state = 'filling'
       AND (SELECT count(*) FROM seats s WHERE s.lobby_id = l.id) <= $1
     ORDER BY l.id LIMIT 1 FOR UPDATE`, [LOBBY_SIZE - members.length], client);
  if (lobby === undefined) {
    lobby = await one<{ id: number }>(
      "INSERT INTO lobbies (state, host_instance, created_at) VALUES ('filling', $1, clock_timestamp()) RETURNING id",
      [party.queued_via ?? instanceId], client);
  }
  if (lobby === undefined) throw new Error("lobby not stored");
  const taken = new Set((await query("SELECT seat FROM seats WHERE lobby_id = $1", [lobby.id], client)).map((row) => Number(row["seat"])));
  let seat = 1;
  for (const userId of members) {
    while (taken.has(seat)) seat += 1;
    taken.add(seat);
    await query("INSERT INTO seats (lobby_id, seat, user_id, party_id, seated_at) VALUES ($1, $2, $3, $4, clock_timestamp())",
      [lobby.id, seat, userId, party.id], client);
  }
  await query("UPDATE parties SET state = 'in_lobby', lobby_id = $1, queued_at = NULL, queued_via = NULL WHERE id = $2", [lobby.id, party.id], client);
  if (taken.size === LOBBY_SIZE) {
    await query(`UPDATE lobbies SET state = 'countdown', countdown_ends_at = clock_timestamp() + make_interval(secs => $2) WHERE id = $1`,
      [lobby.id, COUNTDOWN_SECONDS], client);
  }
  await emit(client, { kind: "party", partyId: party.id });
  await emit(client, { kind: "lobby", lobbyId: lobby.id });
}

// Seats every queued party, oldest queue time first, each into the oldest filling lobby with room for all of it.
export async function seatQueuedParties(): Promise<void> {
  await transaction(async (client) => {
    await lockKey(client, LOCK.seating, 0);
    const queued = await query<{ id: number; queued_via: string | null }>(
      "SELECT id, queued_via FROM parties WHERE state = 'queued' ORDER BY queued_at, id FOR UPDATE", [], client);
    for (const party of queued) await seatParty(client, party);
  });
}

route("GET", "/api/lobbies/:id", "verified", async ({ params }) => {
  const id = positiveId(params[0]);
  const lobby = id === 0 ? null : await loadLobby(id);
  if (lobby === null) throw new ApiError("lobby_not_found");
  return { status: 200, body: { lobby } };
});
