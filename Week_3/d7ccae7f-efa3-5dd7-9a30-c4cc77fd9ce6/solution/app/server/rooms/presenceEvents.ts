import { pool } from "../db.js";
import { connectedSeats } from "../presence.js";
import { appendStandalone } from "./events.js";

const SETTLE_MS = 50;
const lastEmitted = new Map<string, string>();
const scheduled = new Set<string>();

const signature = (seatIds: Set<string>): string => [...seatIds].sort().join(",");

async function emitIfChanged(roomId: string): Promise<void> {
  const connected = connectedSeats(roomId);
  const now = signature(connected);
  if ((lastEmitted.get(roomId) ?? "") === now) return;
  lastEmitted.set(roomId, now);
  const seats = await pool.query<{ id: string; nickname: string }>("SELECT id, nickname FROM seats WHERE room_id = $1 ORDER BY join_seq", [roomId]);
  await appendStandalone(roomId, {
    type: "presence",
    data: {
      seated: seats.rows.length,
      connected: connected.size,
      players: seats.rows.map((seat) => ({ seatId: seat.id, nickname: seat.nickname, connected: connected.has(seat.id) })),
    },
  });
}

// Called whenever a stream opens or closes, and by the sweep; changes within 50 ms share one presence event.
export function presenceMayHaveChanged(roomId: string): void {
  if ((lastEmitted.get(roomId) ?? "") === signature(connectedSeats(roomId)) || scheduled.has(roomId)) return;
  scheduled.add(roomId);
  setTimeout(() => {
    scheduled.delete(roomId);
    emitIfChanged(roomId).catch((error: unknown) => console.error("presence event:", error instanceof Error ? error.message : error));
  }, SETTLE_MS);
}

export function forgetPresence(roomId: string): void {
  lastEmitted.delete(roomId);
}
