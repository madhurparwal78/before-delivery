// Seed data published by the brief. Written to Postgres idempotently; runtime code reads it back from Postgres.

export const SEED_ROOMS = [
  { roomId: "window-row", name: "Window Row", tables: [["T1", 1, 2], ["T2", 1, 2], ["T3", 1, 2], ["T4", 2, 4]] },
  { roomId: "hearth", name: "Hearth", tables: [["T5", 2, 4], ["T6", 2, 4], ["T7", 3, 4], ["T8", 3, 4]] },
  { roomId: "slate-room", name: "Slate Room", tables: [["T9", 4, 6], ["T10", 5, 6], ["T11", 2, 4], ["T12", 2, 4]] },
  { roomId: "bar-rail", name: "Bar Rail", tables: [["T13", 1, 2], ["T14", 1, 2]] },
  { roomId: "courtyard", name: "Courtyard", tables: [["T15", 2, 4], ["T16", 2, 4]] },
  { roomId: "chefs-counter", name: "Chef's Counter", tables: [["C1", 1, 2], ["C2", 1, 2], ["C3", 1, 2]] },
] as const;

export const SEED_PAIRS = [
  { pairId: "T7+T8", tableA: "T7", tableB: "T8", minSeats: 7, maxSeats: 8 },
  { pairId: "T11+T12", tableA: "T11", tableB: "T12", minSeats: 7, maxSeats: 8 },
] as const;

export const SEED_HOST = {
  email: "host@saffronslate.example",
  name: "Inês Duarte",
  password: "Hearth-and-Slate-2026",
} as const;

const SLOT_TIMES = Array.from({ length: 17 }, (_, index) => {
  const minutes = 18 * 60 + index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

export const SEED_RULES = {
  timezone: "Europe/Lisbon",
  slot_times: SLOT_TIMES,
  booking_lead_minutes: 60,
  booking_horizon_days: 30,
  turn_minutes: { "1-2": 90, "3-4": 105, "5-6": 120, "7-8": 150 },
  reset_minutes: 15,
  deposit_cents_per_cover: 1500,
  deposit_min_party: 5,
  deposit_rooms: ["chefs-counter"],
  refund_cutoff_hours: 24,
  no_show_after_minutes: 15,
  host_session_hours: 12,
};
