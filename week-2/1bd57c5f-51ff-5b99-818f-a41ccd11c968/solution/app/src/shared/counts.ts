import type { ItemStatus, Progress, RoomCounts } from "./domain";

// The one derived-count calculation. Room counts and job progress both come from it,
// whether they end up in the list headings, the plan room labels, the API or the
// daily summary email. Callers pass only the items within the viewer's scope.

export interface CountedItem {
  room_id: string;
  status: ItemStatus;
}

interface DerivedCounts {
  rooms: Map<string, RoomCounts>;
  progress: Progress;
}

export function deriveCounts(items: readonly CountedItem[], roomIds: readonly string[]): DerivedCounts {
  const rooms = new Map<string, RoomCounts>(roomIds.map((id) => [id, { verified: 0, total: 0 }]));
  let verified = 0;
  for (const item of items) {
    const done = item.status === "verified";
    if (done) verified += 1;
    const room = rooms.get(item.room_id);
    if (room) {
      room.total += 1;
      if (done) room.verified += 1;
    }
  }
  const total = items.length;
  return {
    rooms,
    progress: { verified, total, percent: total === 0 ? 0 : Math.floor((verified * 100) / total) },
  };
}
