import { rows, type Db, type Tx } from "./db.js";
import { minutesToHHMM, wallClock } from "./kitchenTime.js";

// Occupancy and conflict computation (DP-18, DP-19). The single serialization
// point for one-winner-per-slot is the station_occupancy table's exclusion
// constraint; the helpers here read live ranges and compute conflict answers.

export type OccupancyRange = {
  bookingId: string | null;
  blockId: string | null;
  renterId: string | null;
  startsAt: Date;
  endsAt: Date;
  kind: "booking" | "hold" | "maintenance";
  buffer: boolean;
};

export const liveOccupancy = async (db: Db, stationId: string): Promise<OccupancyRange[]> => {
  const result = await rows<{ booking_id: string | null; block_id: string | null; renter_id: string | null; starts_at: Date; ends_at: Date; status: string | null }>(
    db,
    `select o.booking_id, o.block_id, b.renter_id, o.starts_at, o.ends_at, b.status
     from station_occupancy o
     left join bookings b on b.id = o.booking_id
     where o.station_id = $1 and o.ends_at > now()
     order by o.starts_at asc`,
    [stationId],
  );
  return result.map((r) => ({
    bookingId: r.booking_id,
    blockId: r.block_id,
    renterId: r.renter_id,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    kind: r.block_id ? "maintenance" : r.status === "hold" ? "hold" : "booking",
    buffer: false,
  }));
};

export type ConflictAnswer = {
  blockedBy: "booking" | "buffer" | "maintenance";
  blockedAtMinutes: number;
  blockedAtDate: string;
};

export const findCollision = (
  requested: { startsAt: Date; endsAt: Date },
  live: readonly OccupancyRange[],
  bufferOf: (range: OccupancyRange) => Date,
): OccupancyRange | null => {
  for (const range of live) {
    const occupiedEnd = range.blockId ? range.endsAt : bufferOf(range);
    if (requested.startsAt < occupiedEnd && range.startsAt < requested.endsAt) return range;
  }
  return null;
};

export const classifyCollision = (
  range: OccupancyRange,
  requested: { startsAt: Date },
  bufferOf: (range: OccupancyRange) => Date,
): ConflictAnswer => {
  const wall = wallClock(range.startsAt);
  if (range.blockId) {
    return { blockedBy: "maintenance", blockedAtMinutes: wall.minutes, blockedAtDate: wall.date };
  }
  const ownEnd = range.endsAt;
  if (requested.startsAt < ownEnd) {
    return { blockedBy: "booking", blockedAtMinutes: wall.minutes, blockedAtDate: wall.date };
  }
  return { blockedBy: "buffer", blockedAtMinutes: wall.minutes, blockedAtDate: wall.date };
};

export const legalEndAfter = (
  requestedStart: Date,
  requestedEnd: Date,
  live: readonly OccupancyRange[],
  bufferOf: (range: OccupancyRange) => Date,
): Date | null => {
  // The latest end no later than the requested end that collides with nothing,
  // stepping back in 15-minute units.
  let cursor = new Date(requestedEnd);
  const minStart = new Date(requestedStart.getTime() + 900000);
  while (cursor >= minStart) {
    if (!findCollision({ startsAt: requestedStart, endsAt: cursor }, live, bufferOf)) return cursor;
    cursor = new Date(cursor.getTime() - 900000);
  }
  return null;
};

export const hhmmOfInstant = minutesToHHMM;
