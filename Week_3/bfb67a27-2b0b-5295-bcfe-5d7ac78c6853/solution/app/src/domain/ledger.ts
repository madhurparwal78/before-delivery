import type { Queryable } from '../server/db.js';
import type { Movement, MovementReason, UtilisationView } from '../shared/types.js';

const ACQUIRED = 'acquired';
export const SHELF = 'shelf';
export const REPAIR = 'repair';

export function bookingLocation(ref: string): string {
  return `booking:${ref}`;
}

/**
 * A unit's location is the one place other than `acquired` whose ledger entries
 * sum to 1. Nothing else in the app keeps a unit's whereabouts.
 */
export async function currentLocations(client: Queryable): Promise<Map<string, string>> {
  const result = await client.query<{ serial: string; location: string }>(
    `SELECT m.serial, e.location
       FROM movements m
       JOIN movement_entries e ON e.movement_id = m.id
      WHERE e.location <> $1
      GROUP BY m.serial, e.location
     HAVING SUM(e.delta) = 1`,
    [ACQUIRED],
  );
  return new Map(result.rows.map((row) => [row.serial, row.location]));
}

export async function currentLocation(client: Queryable, serial: string): Promise<string> {
  const result = await client.query<{ location: string }>(
    `SELECT e.location
       FROM movements m
       JOIN movement_entries e ON e.movement_id = m.id
      WHERE m.serial = $1 AND e.location <> $2
      GROUP BY e.location
     HAVING SUM(e.delta) = 1`,
    [serial, ACQUIRED],
  );
  const location = result.rows[0]?.location;
  if (location === undefined) throw new Error(`Unit ${serial} has no balanced location`);
  return location;
}

/** One movement, always with the two balancing entries, in the caller's transaction. */
export async function recordMovement(
  client: Queryable,
  serial: string,
  reason: MovementReason,
  from: string,
  to: string,
  bookingRef: string | null,
): Promise<void> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO movements (id, serial, reason, from_location, to_location, booking_ref)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id`,
    [serial, reason, from, to, bookingRef],
  );
  const movementId = inserted.rows[0]?.id;
  if (movementId === undefined) throw new Error(`Movement for ${serial} was not inserted`);
  await client.query(
    `INSERT INTO movement_entries (movement_id, location, delta) VALUES ($1, $2, -1), ($1, $3, 1)`,
    [movementId, from, to],
  );
}

export async function unitMovements(client: Queryable, serial: string): Promise<Movement[]> {
  const result = await client.query<{
    id: string;
    at: Date;
    reason: MovementReason;
    from_location: string;
    to_location: string;
    booking_ref: string | null;
  }>(
    `SELECT id, at, reason, from_location, to_location, booking_ref
       FROM movements WHERE serial = $1 ORDER BY seq ASC`,
    [serial],
  );
  return result.rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    reason: row.reason,
    from: row.from_location,
    to: row.to_location,
    bookingRef: row.booking_ref,
    entries: [
      { location: row.from_location, delta: -1 },
      { location: row.to_location, delta: 1 },
    ],
  }));
}

export async function unitBalances(
  client: Queryable,
  serial: string,
): Promise<Record<string, number>> {
  const result = await client.query<{ location: string; total: number }>(
    `SELECT e.location, SUM(e.delta)::int AS total
       FROM movements m
       JOIN movement_entries e ON e.movement_id = m.id
      WHERE m.serial = $1
      GROUP BY e.location
     HAVING SUM(e.delta) <> 0
      ORDER BY e.location`,
    [serial],
  );
  const balances: Record<string, number> = {};
  for (const row of result.rows) balances[row.location] = row.total;
  return balances;
}

interface ClassShelfCount {
  kitId: string;
  classId: string;
  onShelf: number;
}

async function shelfCountsByClass(client: Queryable): Promise<ClassShelfCount[]> {
  const locations = await currentLocations(client);
  const classes = await client.query<{ kit_id: string; class_id: string; serial: string }>(
    `SELECT c.kit_id, c.id AS class_id, u.serial
       FROM unit_classes c JOIN units u ON u.class_id = c.id`,
  );
  const counts = new Map<string, ClassShelfCount>();
  for (const row of classes.rows) {
    const entry = counts.get(row.class_id) ?? {
      kitId: row.kit_id,
      classId: row.class_id,
      onShelf: 0,
    };
    if (locations.get(row.serial) === SHELF) entry.onShelf += 1;
    counts.set(row.class_id, entry);
  }
  return [...counts.values()];
}

/** A kit's ready-to-go count: the fewest shelf units across its component classes. */
export async function readyToGoByKit(client: Queryable): Promise<Map<string, number>> {
  const counts = await shelfCountsByClass(client);
  const perKit = new Map<string, number>();
  for (const entry of counts) {
    const soFar = perKit.get(entry.kitId);
    perKit.set(entry.kitId, soFar === undefined ? entry.onShelf : Math.min(soFar, entry.onShelf));
  }
  return perKit;
}

export async function utilisation(client: Queryable): Promise<UtilisationView> {
  const locations = await currentLocations(client);
  let onShelf = 0;
  let out = 0;
  let repair = 0;
  for (const location of locations.values()) {
    if (location === SHELF) onShelf += 1;
    else if (location === REPAIR) repair += 1;
    else out += 1;
  }
  const totalUnits = locations.size;
  const utilisationPercent =
    totalUnits === 0 ? 0 : Math.floor((out * 100) / totalUnits + 0.5);
  const readyToGo = await readyToGoByKit(client);
  const kits = await client.query<{ id: string }>(`SELECT id FROM kits ORDER BY seq ASC`);
  return {
    totalUnits,
    onShelf,
    out,
    repair,
    utilisationPercent,
    kits: kits.rows.map((row) => ({ kitId: row.id, readyToGo: readyToGo.get(row.id) ?? 0 })),
  };
}
