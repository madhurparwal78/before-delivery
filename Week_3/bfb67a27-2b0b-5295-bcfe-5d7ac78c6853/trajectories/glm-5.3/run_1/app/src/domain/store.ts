// The store owns every read of Postgres and the derived counts (DP-34).
// Availability and ledger-derived locations live here as the single source.

import type { QueryResultRow } from 'pg';
import { insertMovement } from '../schema.js';
import { rangesOverlap } from './pricing.js';
import type {
  Kit,
  Movement,
  MovementReason,
  RateCard,
  SerialUnit,
  UnitClass,
} from '../types.js';
import { pool, withTransaction } from '../db.js';

export interface Catalogue {
  kits: Kit[];
  classes: UnitClass[];
  units: SerialUnit[];
}

export async function loadCatalogue(): Promise<Catalogue> {
  const kits = await pool.query<Kit & QueryResultRow>(
    'SELECT id, name, category, position FROM kits ORDER BY position',
  );
  const classes = await pool.query<UnitClass & QueryResultRow>(
    `SELECT id, kit_id AS "kitId", name, replacement_value_cents::int AS "replacementValueCents", position FROM unit_classes ORDER BY position`,
  );
  const units = await pool.query<SerialUnit & QueryResultRow>(
    'SELECT serial, class_id AS "classId" FROM serial_units ORDER BY serial',
  );
  return { kits: kits.rows, classes: classes.rows, units: units.rows };
}

export async function loadRateCards(): Promise<RateCard[]> {
  const cards = await pool.query<{ version: number; effective_date: string; published_at: Date } & QueryResultRow>(
    'SELECT version, effective_date, published_at FROM rate_cards ORDER BY version',
  );
  const rates = await pool.query<{
    kit_id: string;
    version: number;
    day_rate_cents: string;
    deposit_cents: string;
  } & QueryResultRow>('SELECT kit_id, version, day_rate_cents, deposit_cents FROM rates ORDER BY kit_id');
  return cards.rows.map((card) => ({
    version: card.version,
    effectiveDate: formatDate(card.effective_date),
    publishedAt: card.published_at.toISOString(),
    rates: rates.rows
      .filter((rate) => rate.version === card.version)
      .map((rate) => ({
        kitId: rate.kit_id,
        dayRateCents: Number(rate.day_rate_cents),
        depositCents: Number(rate.deposit_cents),
      })),
  }));
}

function formatDate(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
}

export interface ActiveRate {
  version: number;
  dayRateCents: number;
  depositCents: number;
}

export async function activeRateFor(kitId: string, today: string): Promise<ActiveRate | null> {
  const result = await pool.query<{ version: number; day_rate_cents: string; deposit_cents: string } & QueryResultRow>(
    `SELECT rc.version, r.day_rate_cents, r.deposit_cents
       FROM rate_cards rc JOIN rates r ON r.version = rc.version
      WHERE r.kit_id = $1 AND rc.effective_date <= $2
      ORDER BY rc.effective_date DESC, rc.version DESC LIMIT 1`,
    [kitId, today],
  );
  if (result.rowCount === 0) {
    return null;
  }
  return {
    version: result.rows[0].version,
    dayRateCents: Number(result.rows[0].day_rate_cents),
    depositCents: Number(result.rows[0].deposit_cents),
  };
}

// --- Ledger-derived locations (DP-32, DP-34) ---

export interface UnitLedgerLocation {
  serial: string;
  classId: string;
  location: string;
}

export async function unitLocations(): Promise<Map<string, string>> {
  const result = await pool.query<{ serial: string; location: string } & QueryResultRow>(
    `SELECT m.serial, e.location
       FROM movement_entries e JOIN movements m ON m.id = e.movement_id
      WHERE e.location <> 'acquired'
      GROUP BY m.serial, e.location HAVING SUM(e.delta) = 1`,
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.serial, row.location);
  }
  return map;
}

// --- Availability (DP-07, DP-08) ---

export interface HoldingAssignment {
  ref: string;
  pickupDate: string;
  returnDate: string;
  serial: string;
}

export async function holdingAssignments(): Promise<HoldingAssignment[]> {
  const result = await pool.query<HoldingAssignment & QueryResultRow>(
    `SELECT b.ref, b.pickup_date AS "pickupDate", b.return_date AS "returnDate", u.serial
       FROM bookings b JOIN booking_units u ON u.ref = b.ref
      WHERE b.state IN ('quote','confirmed','prepped','out','returned')
        AND (b.state <> 'quote' OR b.hold_expires_at > now())`,
  );
  return result.rows.map((row) => ({
    ref: row.ref,
    pickupDate: formatDate(row.pickupDate),
    returnDate: formatDate(row.returnDate),
    serial: row.serial,
  }));
}

export interface Availability {
  unitLocations: Map<string, string>;
  holdings: HoldingAssignment[];
}

export async function loadAvailability(): Promise<Availability> {
  const [locations, holdings] = await Promise.all([unitLocations(), holdingAssignments()]);
  return { unitLocations: locations, holdings };
}

export function unitIsFree(
  serial: string,
  pickupDate: string,
  returnDate: string,
  availability: Availability,
  excludingRef: string | null,
): boolean {
  const location = availability.unitLocations.get(serial);
  if (location === undefined || location === 'repair') {
    return false;
  }
  for (const holding of availability.holdings) {
    if (holding.serial !== serial || holding.ref === excludingRef) {
      continue;
    }
    if (rangesOverlap(pickupDate, returnDate, holding.pickupDate, holding.returnDate)) {
      return false;
    }
  }
  return true;
}

export function freeSerialsForClass(
  classId: string,
  catalogue: Catalogue,
  availability: Availability,
  pickupDate: string,
  returnDate: string,
  excludingRef: string | null,
): string[] {
  return catalogue.units
    .filter((unit) => unit.classId === classId)
    .map((unit) => unit.serial)
    .filter((serial) => unitIsFree(serial, pickupDate, returnDate, availability, excludingRef))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function kitFreeForDates(
  kit: Kit,
  catalogue: Catalogue,
  availability: Availability,
  pickupDate: string,
  returnDate: string,
): number {
  const classes = catalogue.classes.filter((klass) => klass.kitId === kit.id);
  let free = Number.POSITIVE_INFINITY;
  for (const klass of classes) {
    const freeSerials = freeSerialsForClass(klass.id, catalogue, availability, pickupDate, returnDate, null);
    free = Math.min(free, freeSerials.length);
  }
  return Number.isFinite(free) ? free : 0;
}

export function kitReadyToGo(kit: Kit, catalogue: Catalogue, locations: Map<string, string>): number {
  const classes = catalogue.classes.filter((klass) => klass.kitId === kit.id);
  let ready = Number.POSITIVE_INFINITY;
  for (const klass of classes) {
    const count = catalogue.units.filter(
      (unit) => unit.classId === klass.id && locations.get(unit.serial) === 'shelf',
    ).length;
    ready = Math.min(ready, count);
  }
  return Number.isFinite(ready) ? ready : 0;
}

export interface Utilisation {
  totalUnits: number;
  onShelf: number;
  out: number;
  repair: number;
  utilisationPercent: number;
}

export function utilisation(catalogue: Catalogue, locations: Map<string, string>): Utilisation {
  const totalUnits = catalogue.units.length;
  let onShelf = 0;
  let out = 0;
  let repair = 0;
  for (const unit of catalogue.units) {
    const location = locations.get(unit.serial);
    if (location === 'repair') {
      repair += 1;
    } else if (location !== undefined && location.startsWith('booking:')) {
      out += 1;
    } else if (location === 'shelf') {
      onShelf += 1;
    }
  }
  return { totalUnits, onShelf, out, repair, utilisationPercent: halfUp(out * 100, totalUnits) };
}

function halfUp(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  const exact = (numerator * 2 + denominator) / (denominator * 2);
  return Math.floor(exact);
}

// --- Movement writes (DP-32, DP-33) ---

export async function moveUnit(
  serial: string,
  reason: MovementReason,
  from: string,
  to: string,
  bookingRef: string | null,
): Promise<void> {
  await withTransaction(async (client) => {
    const locked = await client.query<{ location: string } & QueryResultRow>(
      `SELECT e.location
         FROM movement_entries e JOIN movements m ON m.id = e.movement_id
        WHERE m.serial = $1 AND e.location <> 'acquired'
        GROUP BY e.location HAVING SUM(e.delta) = 1`,
      [serial],
    );
    await client.query('SELECT 1 FROM movements WHERE serial = $1 ORDER BY id FOR UPDATE', [serial]);
    const current = locked.rows.length > 0 ? locked.rows[0].location : 'acquired';
    if (current !== from) {
      throw new IllegalMoveError(serial, current, to);
    }
    if (from === to) {
      throw new IllegalMoveError(serial, from, to);
    }
    await insertMovement(client, serial, reason, from, to, bookingRef);
  });
}

export class IllegalMoveError extends Error {
  constructor(
    public readonly serial: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`${serial} can't move from ${from} to ${to}`);
  }
}

export async function unitHistory(serial: string): Promise<{ location: string; movements: Movement[]; balances: Map<string, number> } | null> {
  const result = await pool.query<
    { id: string; reason: MovementReason; from_location: string; to_location: string; booking_ref: string | null; at: Date } & QueryResultRow
  >(
    'SELECT id, reason, from_location, to_location, booking_ref, at FROM movements WHERE serial = $1 ORDER BY at, id',
    [serial],
  );
  if (result.rowCount === 0) {
    return null;
  }
  const movements: Movement[] = result.rows.map((row) => ({
    id: Number(row.id),
    serial,
    reason: row.reason,
    fromLocation: row.from_location,
    toLocation: row.to_location,
    bookingRef: row.booking_ref,
    at: row.at,
  }));
  const balances = new Map<string, number>();
  for (const movement of movements) {
    balances.set(movement.fromLocation, (balances.get(movement.fromLocation) ?? 0) - 1);
    balances.set(movement.toLocation, (balances.get(movement.toLocation) ?? 0) + 1);
  }
  for (const [location, sum] of [...balances]) {
    if (sum === 0) {
      balances.delete(location);
    }
  }
  let location = '';
  for (const [loc, sum] of balances) {
    if (loc !== 'acquired' && sum === 1) {
      location = loc;
    }
  }
  return { location, movements, balances };
}


