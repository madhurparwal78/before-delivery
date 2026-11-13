import { pool } from "../db.js";
import { notFound } from "../errors.js";
import { isUuid } from "../ids.js";

// A room is the quizmaster's own, or it answers as if it did not exist.
export async function ownedRoomId(quizmasterId: string, roomId: string): Promise<string> {
  const found = isUuid(roomId) ? await pool.query("SELECT 1 FROM rooms WHERE id = $1 AND quizmaster_id = $2", [roomId, quizmasterId]) : null;
  if (!found?.rowCount) throw notFound();
  return roomId;
}
