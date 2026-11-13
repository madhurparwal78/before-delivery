import { LOBBY_SIZE } from '../../shared/rounds.js';
import type { Lobby, LobbyState } from '../../shared/types.js';
import { type Tx, query, queryOne } from '../db.js';
import { hub } from '../ws/hub.js';

interface LobbyRow {
  id: number;
  state: LobbyState;
  countdown_ends_at: Date | null;
  match_id: number | null;
}

interface SeatRow {
  seat: number;
  user_id: number;
  party_id: number;
  seated_at: Date;
}

export async function lobbyPayload(lobbyId: number): Promise<Lobby | null> {
  const lobby = await queryOne<LobbyRow>(
    'SELECT id, state, countdown_ends_at, match_id FROM lobbies WHERE id = $1',
    [lobbyId],
  );
  if (lobby === null) return null;
  const seats = await query<SeatRow>(
    'SELECT seat, user_id, party_id, seated_at FROM lobby_seats WHERE lobby_id = $1 ORDER BY seat',
    [lobbyId],
  );
  const filled = new Map(seats.map((row) => [row.seat, row]));
  return {
    id: lobby.id,
    state: lobby.state,
    size: LOBBY_SIZE,
    seats: Array.from({ length: LOBBY_SIZE }, (_, index) => {
      const seat = index + 1;
      const row = filled.get(seat);
      return {
        seat,
        userId: row?.user_id ?? null,
        partyId: row?.party_id ?? null,
        seatedAt: row?.seated_at.toISOString() ?? null,
      };
    }),
    countdownEndsAt: lobby.countdown_ends_at?.toISOString() ?? null,
    matchId: lobby.match_id,
  };
}

export async function seatedUserIds(lobbyId: number): Promise<number[]> {
  const rows = await query<{ user_id: number }>(
    'SELECT user_id FROM lobby_seats WHERE lobby_id = $1 ORDER BY seat',
    [lobbyId],
  );
  return rows.map((row) => row.user_id);
}

export async function pushLobby(lobbyId: number): Promise<void> {
  const lobby = await lobbyPayload(lobbyId);
  if (lobby === null) return;
  const seated = lobby.seats.flatMap((seat) => (seat.userId === null ? [] : [seat.userId]));
  hub.broadcast(seated, { type: 'lobby', lobby });
}

/** Freeing a seat cancels any countdown and reopens the seat. */
export async function releaseSeats(
  tx: Tx,
  lobbyId: number,
  userIds: readonly number[],
): Promise<void> {
  if (userIds.length === 0) return;
  await tx.query('SELECT id FROM lobbies WHERE id = $1 FOR UPDATE', [lobbyId]);
  await tx.query('DELETE FROM lobby_seats WHERE lobby_id = $1 AND user_id = ANY($2::int[])', [
    lobbyId,
    userIds,
  ]);
  await tx.query(
    `UPDATE lobbies SET state = 'filling', countdown_ends_at = NULL
     WHERE id = $1 AND state = 'countdown'`,
    [lobbyId],
  );
}
