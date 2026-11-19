import type {
  AvailabilityResponse,
  AvailabilitySlot,
  PlanResponse,
  PlanTableStatus,
  TonightResponse,
} from '../../shared/types';
import type { Db } from '../db';
import { isoUtc, isoWithLisbonOffset, lisbonDate } from '../time';
import {
  eligibleUnits,
  fitsBySeatRange,
  loadLayout,
  requireRoom,
  requireUnit,
  type Layout,
  type Unit,
} from './floor';
import {
  coversFree,
  eveningWindows,
  occupiedTableIds,
  unitFreeForWindow,
  type ActiveWindow,
} from './occupancy';
import { SLOT_TIMES, slotReason, slotStartsAt, turnWindow } from './rules';

/** The units a party may hold at a slot: fitting, free for the whole window, smallest maximum seats. */
export function eligibleUnitsAt(
  layout: Layout,
  windows: ActiveWindow[],
  partySize: number,
  startsAt: Date,
  ignore: { holdId?: string } = {},
): Unit[] {
  const window = turnWindow(partySize, startsAt);
  const candidates = layout.units.filter(
    (unit) => fitsBySeatRange(unit, partySize) && unitFreeForWindow(windows, unit, window, ignore),
  );
  return eligibleUnits(candidates);
}

export async function availabilityFor(
  db: Db,
  date: string,
  partySize: number,
  now: Date,
): Promise<AvailabilityResponse> {
  const layout = await loadLayout(db);
  const windows = await eveningWindows(db, date, now);
  const slots: AvailabilitySlot[] = SLOT_TIMES.map((time) => {
    const startsAt = slotStartsAt(date, time);
    const reason = slotReason(date, time, now);
    const occupied = occupiedTableIds(windows, startsAt);
    const covers = coversFree(layout, occupied);
    const eligible = reason === null ? eligibleUnitsAt(layout, windows, partySize, startsAt) : [];
    return {
      time,
      starts_at: isoWithLisbonOffset(startsAt),
      bookable: reason === null,
      reason,
      covers_free: covers.total,
      rooms: layout.rooms.map((room) => ({
        room_id: room.roomId,
        covers_free: covers.byRoom.get(room.roomId) ?? 0,
      })),
      eligible_tables: eligible.length,
    };
  });
  return { date, party_size: partySize, server_now: isoUtc(now), slots };
}

export async function planFor(
  db: Db,
  date: string,
  time: string,
  partySize: number,
  now: Date,
): Promise<PlanResponse> {
  const layout = await loadLayout(db);
  const windows = await eveningWindows(db, date, now);
  const startsAt = slotStartsAt(date, time);
  const bookable = slotReason(date, time, now) === null;
  const occupied = occupiedTableIds(windows, startsAt);
  const eligible = bookable ? eligibleUnitsAt(layout, windows, partySize, startsAt) : [];
  const eligibleIds = new Set(eligible.map((unit) => unit.unitId));

  const statusFor = (unit: Unit): PlanTableStatus => {
    if (unit.tableIds.some((tableId) => occupied.has(tableId))) return 'taken';
    return eligibleIds.has(unit.unitId) ? 'fits' : 'not_for_party';
  };

  return {
    date,
    time,
    party_size: partySize,
    tables: layout.tables.map((table) => {
      const unit = requireUnit(layout, table.tableId);
      return {
        table_id: table.tableId,
        room_id: table.roomId,
        min_seats: table.minSeats,
        max_seats: table.maxSeats,
        status: statusFor(unit),
      };
    }),
    pairs:
      partySize >= 7
        ? layout.pairs.map((pair) => ({
            pair_id: pair.pairId,
            status: statusFor(requireUnit(layout, pair.pairId)),
          }))
        : [],
  };
}

export async function tonightFor(db: Db, now: Date): Promise<TonightResponse> {
  const layout = await loadLayout(db);
  const date = lisbonDate(now);
  const windows = await eveningWindows(db, date, now);
  const bookableTimes = SLOT_TIMES.filter((time) => slotReason(date, time, now) === null);
  const nextSlot = bookableTimes[0] ?? null;
  const nextSlotOccupied =
    nextSlot === null ? null : occupiedTableIds(windows, slotStartsAt(date, nextSlot));
  const covers = nextSlotOccupied === null ? null : coversFree(layout, nextSlotOccupied);

  const nextTableForTwo = (roomId: string): string | null => {
    const room = requireRoom(layout, roomId);
    for (const time of bookableTimes) {
      const window = turnWindow(2, slotStartsAt(date, time));
      const free = room.tables.some((table) => {
        const unit = requireUnit(layout, table.tableId);
        return fitsBySeatRange(unit, 2) && unitFreeForWindow(windows, unit, window);
      });
      if (free) return time;
    }
    return null;
  };

  return {
    date,
    server_now: isoUtc(now),
    next_slot: nextSlot,
    rooms: layout.rooms.map((room) => ({
      room_id: room.roomId,
      name: room.name,
      seats: room.seats,
      covers_free_at_next_slot: covers === null ? null : (covers.byRoom.get(room.roomId) ?? 0),
      next_table_for_two: nextTableForTwo(room.roomId),
    })),
  };
}
