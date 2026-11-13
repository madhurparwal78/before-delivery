import { databaseReady, pool } from "../db.js";
import { openStreamClients } from "../presence.js";
import { rebuildRoom } from "./valkey.js";

// Valkey is back (or just started): rewrite each unended room's leaderboard set and clients set from Postgres and this process.
export async function rebuildLiveState(): Promise<void> {
  if (!databaseReady()) return;
  const rooms = await pool.query<{ id: string }>("SELECT id FROM rooms WHERE state <> 'ended'");
  for (const { id } of rooms.rows) {
    const standings = await pool.query<{ seat_id: string; score: number }>("SELECT seat_id, score FROM standings WHERE room_id = $1", [id]);
    await rebuildRoom(id, standings.rows.map((row) => ({ seatId: row.seat_id, score: row.score })), openStreamClients(id));
  }
}
