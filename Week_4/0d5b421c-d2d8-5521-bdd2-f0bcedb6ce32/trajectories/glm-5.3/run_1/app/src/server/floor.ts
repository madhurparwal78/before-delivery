import { ROOMS, JOINABLE_PAIRS, SLOT_TIMES } from "../shared/seed.js";
export { ROOMS, JOINABLE_PAIRS, SLOT_TIMES };
import {
  BOOKING_HORIZON_DAYS, BOOKING_LEAD_MINUTES, DEPOSIT_CENTS_PER_COVER, DEPOSIT_MIN_PARTY,
  DEPOSIT_ROOMS, HOST_SESSION_HOURS, NO_SHOW_AFTER_MINUTES, REFUND_CUTOFF_HOURS,
  RESET_MINUTES, turnMinutes,
} from "../shared/seed.js";

export interface TableInfo {
  table_id: string;
  room_id: string;
  min_seats: number;
  max_seats: number;
}

export interface PairInfo {
  pair_id: string;
  tables: [string, string];
  min_seats: number;
  max_seats: number;
  room_id: string;
}

export const TABLES: TableInfo[] = ROOMS.flatMap((room) =>
  room.tables.map((t) => ({ ...t, room_id: room.room_id })),
);

export const TABLE_BY_ID = new Map<string, TableInfo>(TABLES.map((t) => [t.table_id, t]));

export const PAIRS: PairInfo[] = JOINABLE_PAIRS.map((p) => {
  const room = TABLE_BY_ID.get(p.tables[0])?.room_id ?? "";
  return { ...p, room_id: room };
});

export const PAIR_BY_ID = new Map<string, PairInfo>(PAIRS.map((p) => [p.pair_id, p]));

export const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.room_id, r]));

export function roomName(roomId: string): string {
  return ROOM_BY_ID.get(roomId)?.name ?? roomId;
}

export function roomNameForTable(tableId: string): string {
  return roomName(TABLE_BY_ID.get(tableId)?.room_id ?? "");
}

export function tableIdsForTarget(targetId: string): string[] {
  const pair = PAIR_BY_ID.get(targetId);
  if (pair) return [pair.tables[0], pair.tables[1]];
  return [targetId];
}

export function maxSeatsForTarget(targetId: string): number {
  const pair = PAIR_BY_ID.get(targetId);
  if (pair) return pair.max_seats;
  return TABLE_BY_ID.get(targetId)?.max_seats ?? 0;
}

/** Table fit by seat range: min ≤ party ≤ max, with pairs for parties of 7 or 8. */
export function fitsBySeatRange(targetId: string, partySize: number): boolean {
  const pair = PAIR_BY_ID.get(targetId);
  if (partySize >= 7) {
    return pair !== undefined && pair.min_seats <= partySize && partySize <= pair.max_seats;
  }
  if (pair) return false;
  const table = TABLE_BY_ID.get(targetId);
  if (!table) return false;
  return table.min_seats <= partySize && partySize <= table.max_seats;
}

/** All candidate targets for a party: individual tables and, for 7-8, joinable pairs. */
export function targetsForParty(partySize: number): string[] {
  const pairIds = partySize >= 7 ? PAIRS.map((p) => p.pair_id) : [];
  const tableIds = partySize >= 7 ? [] : TABLES.filter((t) => t.max_seats <= 6).map((t) => t.table_id);
  return [...tableIds.filter((id) => fitsBySeatRange(id, partySize)), ...pairIds];
}

/** Deposit rule: €15 per cover for parties of 5+ or at Chef's Counter. */
export function depositCentsFor(partySize: number, targetId: string): number {
  const roomOfTarget = (() => {
    const pair = PAIR_BY_ID.get(targetId);
    if (pair) return TABLE_BY_ID.get(pair.tables[0])?.room_id ?? "";
    return TABLE_BY_ID.get(targetId)?.room_id ?? "";
  })();
  const depositApplies = partySize >= DEPOSIT_MIN_PARTY || DEPOSIT_ROOMS.includes(roomOfTarget);
  return depositApplies ? DEPOSIT_CENTS_PER_COVER * partySize : 0;
}

/** The turn window of a party at a start instant: turn minutes plus reset. */
export function turnWindow(start: Date, partySize: number): { start: Date; end: Date } {
  const minutes = turnMinutes(partySize) + RESET_MINUTES;
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

/** Covered slots: every quarter-hour instant from window start up to, not including, end. */
export function coveredSlots(start: Date, partySize: number): { date: string; time: string }[] {
  const { end } = turnWindow(start, partySize);
  const out: { date: string; time: string }[] = [];
  let t = new Date(start.getTime());
  while (t.getTime() < end.getTime()) {
    out.push(lisbonSlotOf(t));
    t = new Date(t.getTime() + 15 * 60_000);
  }
  return out;
}

function lisbonSlotOf(instant: Date): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour").padStart(2, "0")}:${get("minute")}`;
  return { date, time };
}

/** Lisbon date and time of a slot instant. */
export { lisbonSlotOf };

export const rules = {
  slotTimes: SLOT_TIMES,
  bookingLeadMinutes: BOOKING_LEAD_MINUTES,
  bookingHorizonDays: BOOKING_HORIZON_DAYS,
  resetMinutes: RESET_MINUTES,
  depositCentsPerCover: DEPOSIT_CENTS_PER_COVER,
  depositMinParty: DEPOSIT_MIN_PARTY,
  depositRooms: DEPOSIT_ROOMS,
  refundCutoffHours: REFUND_CUTOFF_HOURS,
  noShowAfterMinutes: NO_SHOW_AFTER_MINUTES,
  hostSessionHours: HOST_SESSION_HOURS,
};
