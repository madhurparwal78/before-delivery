// The kitchen's reference data (name, zone, stations, packs) and kitchen-time helpers over the server clock.

import type { Kitchen, Pack, Station } from "../shared/api.js";
import { BOARD_CLOSES, BOARD_OPENS, BOOKING_DAYS_AHEAD, CELL_MINUTES, CHECK_IN_OPENS_MINUTES, FREE_CANCEL_DAYS, clock, formatMoney } from "../shared/rules.js";
import { isoInstant, kitchenDate } from "../shared/zone.js";
import { now } from "./clock.js";
import type { Db } from "./db.js";

export interface StationRecord {
  id: string;
  name: string;
  rateCents: number;
  cleaningMinutes: number;
}

interface PackRecord {
  id: string;
  name: string;
  minutes: number;
  priceCents: number;
}

interface Catalog {
  name: string;
  timeZone: string;
  stations: StationRecord[];
  packs: PackRecord[];
}

let catalog: Catalog = { name: "", timeZone: "UTC", stations: [], packs: [] };

/** Loads the seeded kitchen, stations and packs; they cannot be edited in the product. */
export async function loadCatalog(db: Db): Promise<void> {
  const kitchenRow = await db.query<{ name: string; time_zone: string }>("SELECT name, time_zone FROM kitchen LIMIT 1");
  const stations = await db.query<{ id: string; name: string; hourly_rate_cents: number; cleaning_minutes: number }>(
    "SELECT id, name, hourly_rate_cents, cleaning_minutes FROM stations ORDER BY position",
  );
  const packs = await db.query<{ id: string; name: string; minutes: number; price_cents: number }>(
    "SELECT id, name, minutes, price_cents FROM packs ORDER BY position",
  );
  const first = kitchenRow.rows[0];
  if (!first) throw new Error("kitchen row missing after seed");
  catalog = {
    name: first.name,
    timeZone: first.time_zone,
    stations: stations.rows.map((s) => ({ id: s.id, name: s.name, rateCents: s.hourly_rate_cents, cleaningMinutes: s.cleaning_minutes })),
    packs: packs.rows.map((p) => ({ id: p.id, name: p.name, minutes: p.minutes, priceCents: p.price_cents })),
  };
}

export function kitchenName(): string {
  return catalog.name;
}

export function timeZone(): string {
  return catalog.timeZone;
}

export function stations(): StationRecord[] {
  return catalog.stations;
}

export function station(id: unknown): StationRecord | undefined {
  return catalog.stations.find((s) => s.id === id);
}

/** The station of a stored hold or booking; stations are seeded and never removed. */
export function stationOf(id: string): StationRecord {
  const found = station(id);
  if (!found) throw new Error(`station ${id} is not in the kitchen catalog`);
  return found;
}

export function stationName(id: string): string {
  return stationOf(id).name;
}

export function pack(id: string): PackRecord | undefined {
  return catalog.packs.find((p) => p.id === id);
}

/** The kitchen's today: the date in the kitchen's zone at the server's now. */
export function today(): string {
  return kitchenDate(now(), catalog.timeZone);
}

/** An instant as ISO 8601 with the kitchen's offset. */
export function iso(instant: number | Date): string {
  return isoInstant(typeof instant === "number" ? instant : instant.getTime(), catalog.timeZone);
}

export function isoOrNull(instant: Date | null): string | null {
  return instant ? iso(instant) : null;
}

function stationJson(s: StationRecord): Station {
  return { id: s.id, name: s.name, hourly_rate: formatMoney(s.rateCents), cleaning_minutes: s.cleaningMinutes };
}

function packJson(p: PackRecord): Pack {
  return { id: p.id, name: p.name, minutes: p.minutes, price: formatMoney(p.priceCents) };
}

export function kitchenJson(holdSeconds: number, billing: Kitchen["billing"]): Kitchen {
  const at = now();
  return {
    name: catalog.name,
    time_zone: catalog.timeZone,
    now: iso(at),
    today: kitchenDate(at, catalog.timeZone),
    hold_seconds: holdSeconds,
    free_cancel_days: FREE_CANCEL_DAYS,
    check_in_opens_minutes: CHECK_IN_OPENS_MINUTES,
    booking_days_ahead: BOOKING_DAYS_AHEAD,
    board: { opens: clock(BOARD_OPENS), closes: clock(BOARD_CLOSES), cell_minutes: CELL_MINUTES },
    stations: catalog.stations.map(stationJson),
    packs: catalog.packs.map(packJson),
    billing,
  };
}
