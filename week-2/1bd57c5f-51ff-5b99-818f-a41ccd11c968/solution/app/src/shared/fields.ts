import { EDITABLE_FIELDS, sameFieldValue, type EditableField, type ItemFields, type PinStatus } from "./domain";
import { outlineContains, roomForPin, type Outline } from "./geometry";

// How a set of field changes lands on an item: setting a pin decides the room (the
// requested room, then the current room, break a shared-edge tie), and changing the room
// alone clears a pin that is not inside the new room. The server applies every PATCH,
// merged sync change and conflict resolution through this; the browser applies queued
// offline edits through it too.

export type FieldPatch = { [F in EditableField]?: ItemFields[F] };

interface PlacedRoom {
  id: string;
  outline: Outline;
}

export interface PatchedItem {
  fields: ItemFields;
  pinStatus: PinStatus;
}

type PatchOutcome = { ok: true; changed: EditableField[] } & PatchedItem | { ok: false; field: "pin" };

export function applyFieldPatch(
  current: PatchedItem,
  patch: FieldPatch,
  rooms: readonly PlacedRoom[],
  tieBreakRoomId: string | null = null,
): PatchOutcome {
  const before = current.fields;
  const next: ItemFields = { ...before };
  let pinStatus = current.pinStatus;
  for (const field of ["title", "trade", "cost_note", "quantity", "unit_cost"] as const) {
    if (patch[field] !== undefined) Object.assign(next, { [field]: patch[field] });
  }
  if (patch.pin) {
    const room = roomForPin(rooms, patch.pin, [patch.room_id ?? tieBreakRoomId, before.room_id]);
    if (!room) return { ok: false, field: "pin" };
    next.pin = patch.pin;
    next.room_id = room.id;
    pinStatus = "placed";
  } else {
    if (patch.pin === null && before.pin !== null) {
      next.pin = null;
      pinStatus = "unpinned";
    }
    if (patch.room_id !== undefined) {
      next.room_id = patch.room_id;
      const room = rooms.find((candidate) => candidate.id === patch.room_id);
      if (next.pin && room && !outlineContains(room.outline, next.pin)) {
        next.pin = null;
        pinStatus = "unpinned";
      }
    }
  }
  const changed = EDITABLE_FIELDS.filter((field) => !sameFieldValue(before[field], next[field]));
  return { ok: true, fields: next, pinStatus, changed };
}
