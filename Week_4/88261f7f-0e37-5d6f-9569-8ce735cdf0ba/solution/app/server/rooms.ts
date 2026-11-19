import type { Role } from "../shared/api";
import { notices } from "../shared/notices";
import { boardRooms, boardView } from "./board";
import { atomic, database, run } from "./db";
import { fail, isUuid, ok, type JsonObject, type Reply } from "./http";
import { emit } from "./live";
import { ROOM_STATUSES, roomStatusMoveAllowed } from "./rules/roomStatus";
import { roomOf } from "./stays";

export async function boardReply(hotelId: string): Promise<Reply> {
  return ok(await boardView(database(), hotelId));
}

export async function changeRoomStatus(hotelId: string, role: Role, roomId: string, body: JsonObject): Promise<Reply> {
  await atomic(async (client) => {
    if (!isUuid(roomId) || (await run(client, "SELECT 1 FROM rooms WHERE id = $1 AND hotel_id = $2 FOR UPDATE", [roomId, hotelId])) === 0) throw fail.notFound();
    const current = await roomOf(client, roomId);
    const wanted = ROOM_STATUSES.find((status) => status === body.status);
    if (!wanted) throw fail.invalid({ status: "Choose dirty, clean, inspected or out of order." });
    if (!roomStatusMoveAllowed(role, current.status, wanted)) throw fail.conflict("That room status change is not allowed.");
    await run(client, "UPDATE rooms SET status = $2 WHERE id = $1", [roomId, wanted]);
    await emit(client, hotelId, { type: "room", roomId, notice: notices.roomStatus(current.number, wanted) }, [roomId]);
  });
  return ok((await boardRooms(database(), hotelId, roomId))[0]);
}
