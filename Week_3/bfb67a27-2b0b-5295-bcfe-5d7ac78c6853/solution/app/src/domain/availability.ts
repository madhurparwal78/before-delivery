import type { Queryable } from '../server/db.js';
import type { UnitStatusForDates } from '../shared/types.js';
import { currentLocations, REPAIR } from './ledger.js';

/** The states in which a booking holds its assigned units. */
const HOLDING_STATES = ['confirmed', 'prepped', 'out', 'returned'];

export interface DateRange {
  pickupDate: string;
  returnDate: string;
}

/**
 * Serials claimed by another holding booking whose hire range overlaps the one
 * asked about. A quote only holds while its hold is still running.
 */
async function claimedSerials(
  client: Queryable,
  range: DateRange,
  exceptRef: string | null,
): Promise<Set<string>> {
  const result = await client.query<{ serial: string }>(
    `SELECT bu.serial
       FROM booking_units bu
       JOIN bookings b ON b.ref = bu.booking_ref
      WHERE (b.state = ANY($1) OR (b.state = 'quote' AND b.hold_expires_at > now()))
        AND b.pickup_date <= $2::date
        AND $3::date <= b.return_date
        AND ($4::text IS NULL OR b.ref <> $4::text)`,
    [HOLDING_STATES, range.returnDate, range.pickupDate, exceptRef],
  );
  return new Set(result.rows.map((row) => row.serial));
}

interface UnitPlace {
  serial: string;
  classId: string;
  location: string;
}

interface UnitAvailability extends UnitPlace {
  status: UnitStatusForDates;
}

/** Every unit with its ledger location, for reads that ask about no dates. */
export async function unitLocations(client: Queryable): Promise<UnitPlace[]> {
  const locations = await currentLocations(client);
  const units = await client.query<{ serial: string; class_id: string }>(
      `SELECT serial, class_id FROM units ORDER BY serial ASC`,
    );
  return units.rows.map((row) => ({
    serial: row.serial,
    classId: row.class_id,
    location: locations.get(row.serial) ?? REPAIR,
  }));
}

/**
 * Availability of every unit for a hire range. A unit is free when it is not in
 * repair and no other holding booking with an overlapping range has it.
 */
export async function unitAvailability(
  client: Queryable,
  range: DateRange,
  exceptRef: string | null,
): Promise<UnitAvailability[]> {
  const places = await unitLocations(client);
  const claimed = await claimedSerials(client, range, exceptRef);
  return places.map((place) => ({
    ...place,
    status:
      place.location === REPAIR
        ? ('repair' as const)
        : claimed.has(place.serial)
          ? ('booked' as const)
          : ('free' as const),
  }));
}

export async function freeSerialsByClass(
  client: Queryable,
  range: DateRange,
  exceptRef: string | null,
): Promise<Map<string, string[]>> {
  const availability = await unitAvailability(client, range, exceptRef);
  const byClass = new Map<string, string[]>();
  for (const unit of availability) {
    if (unit.status !== 'free') continue;
    const list = byClass.get(unit.classId) ?? [];
    list.push(unit.serial);
    byClass.set(unit.classId, list);
  }
  for (const list of byClass.values()) list.sort();
  return byClass;
}

/** A kit's free count: the fewest free units across its component classes. */
export async function freeForDatesByKit(
  client: Queryable,
  range: DateRange,
): Promise<Map<string, number>> {
  const availability = await unitAvailability(client, range, null);
  const classes = await client.query<{ kit_id: string; class_id: string }>(
      `SELECT kit_id, id AS class_id FROM unit_classes`,
    );
  const freePerClass = new Map<string, number>();
  for (const row of classes.rows) freePerClass.set(row.class_id, 0);
  for (const unit of availability) {
    if (unit.status !== 'free') continue;
    freePerClass.set(unit.classId, (freePerClass.get(unit.classId) ?? 0) + 1);
  }
  const perKit = new Map<string, number>();
  for (const row of classes.rows) {
    const free = freePerClass.get(row.class_id) ?? 0;
    const soFar = perKit.get(row.kit_id);
    perKit.set(row.kit_id, soFar === undefined ? free : Math.min(soFar, free));
  }
  return perKit;
}

/**
 * Serializes every unit claim so that of any number of simultaneous holds or
 * swaps for one unit, exactly one succeeds.
 */
const CLAIM_LOCK = 4_417_001;

export async function lockUnitClaims(client: Queryable): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [CLAIM_LOCK]);
}
