import { pool } from "../db.js";
import { apiError } from "../errors.js";

type SeatedClient = { clientId: string; seatId: string; roomId: string };

// Player endpoints: an unknown client is 401, a retired one 409, a client of an ended room 410.
export async function resolveClient(clientId: unknown, roomId: string | null): Promise<SeatedClient> {
  const found =
    typeof clientId === "string" && !clientId.includes("\u0000")
      ? await pool.query<{ client_id: string; seat_id: string; room_id: string; retired: boolean; state: string }>(
          `SELECT c.client_id, c.seat_id, c.room_id, c.retired, r.state FROM clients c JOIN rooms r ON r.id = c.room_id WHERE c.client_id = $1`,
          [clientId],
        )
      : null;
  const row = found?.rows[0];
  if (!row || (roomId !== null && row.room_id !== roomId)) throw apiError(401, "invalid_client");
  if (row.retired) throw apiError(409, "client_superseded");
  if (row.state === "ended") throw apiError(410, "room_ended");
  return { clientId: row.client_id, seatId: row.seat_id, roomId: row.room_id };
}
