export interface RoomSeed {
  room_id: string;
  name: string;
  seats: number;
  tables: { table_id: string; min_seats: number; max_seats: number }[];
}

export interface JoinablePairSeed {
  pair_id: string;
  tables: [string, string];
  min_seats: number;
  max_seats: number;
}

export const ROOMS: RoomSeed[] = [
  {
    room_id: "window-row",
    name: "Window Row",
    seats: 10,
    tables: [
      { table_id: "T1", min_seats: 1, max_seats: 2 },
      { table_id: "T2", min_seats: 1, max_seats: 2 },
      { table_id: "T3", min_seats: 1, max_seats: 2 },
      { table_id: "T4", min_seats: 2, max_seats: 4 },
    ],
  },
  {
    room_id: "hearth",
    name: "Hearth",
    seats: 16,
    tables: [
      { table_id: "T5", min_seats: 2, max_seats: 4 },
      { table_id: "T6", min_seats: 2, max_seats: 4 },
      { table_id: "T7", min_seats: 3, max_seats: 4 },
      { table_id: "T8", min_seats: 3, max_seats: 4 },
    ],
  },
  {
    room_id: "slate-room",
    name: "Slate Room",
    seats: 20,
    tables: [
      { table_id: "T9", min_seats: 4, max_seats: 6 },
      { table_id: "T10", min_seats: 5, max_seats: 6 },
      { table_id: "T11", min_seats: 2, max_seats: 4 },
      { table_id: "T12", min_seats: 2, max_seats: 4 },
    ],
  },
  {
    room_id: "bar-rail",
    name: "Bar Rail",
    seats: 4,
    tables: [
      { table_id: "T13", min_seats: 1, max_seats: 2 },
      { table_id: "T14", min_seats: 1, max_seats: 2 },
    ],
  },
  {
    room_id: "courtyard",
    name: "Courtyard",
    seats: 8,
    tables: [
      { table_id: "T15", min_seats: 2, max_seats: 4 },
      { table_id: "T16", min_seats: 2, max_seats: 4 },
    ],
  },
  {
    room_id: "chefs-counter",
    name: "Chef's Counter",
    seats: 6,
    tables: [
      { table_id: "C1", min_seats: 1, max_seats: 2 },
      { table_id: "C2", min_seats: 1, max_seats: 2 },
      { table_id: "C3", min_seats: 1, max_seats: 2 },
    ],
  },
];

export const JOINABLE_PAIRS: JoinablePairSeed[] = [
  { pair_id: "T7+T8", tables: ["T7", "T8"], min_seats: 7, max_seats: 8 },
  { pair_id: "T11+T12", tables: ["T11", "T12"], min_seats: 7, max_seats: 8 },
];

export const SLOT_TIMES: string[] = (() => {
  // Slots run every 15 minutes from 18:00 to 22:00 (the last seating): 17 per evening.
  const times: string[] = [];
  for (let m = 18 * 60; m <= 22 * 60; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    times.push(`${hh}:${mm}`);
  }
  return times;
})();

export const BOOKING_LEAD_MINUTES = 60;
export const BOOKING_HORIZON_DAYS = 30;
export const RESET_MINUTES = 15;
export const DEPOSIT_CENTS_PER_COVER = 1500;
export const DEPOSIT_MIN_PARTY = 5;
export const DEPOSIT_ROOMS = ["chefs-counter"];
export const REFUND_CUTOFF_HOURS = 24;
export const NO_SHOW_AFTER_MINUTES = 15;
export const HOST_SESSION_HOURS = 12;

export type PartySize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Turn minutes by party size per the published rules. */
export function turnMinutes(partySize: number): number {
  if (partySize <= 2) return 90;
  if (partySize <= 4) return 105;
  if (partySize <= 6) return 120;
  return 150;
}
