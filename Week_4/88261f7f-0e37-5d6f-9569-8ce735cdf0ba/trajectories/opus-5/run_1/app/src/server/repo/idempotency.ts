import { createHash } from 'node:crypto';
import { Db, one } from '../db';

/** A stable hash of the request body, so key reuse with a different body is refused. */
export function bodyHash(body: Record<string, unknown>): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : 1,
      );
      return entries.map(([key, inner]) => [key, canonical(inner)]);
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
}

export type Reservation =
  | { kind: 'reserved' }
  | { kind: 'mismatch' }
  | { kind: 'inFlight' }
  | { kind: 'replay'; status: number; response: unknown };

export async function reserve(
  db: Db,
  hotelId: string,
  key: string,
  hash: string,
): Promise<Reservation> {
  const inserted = await one<{ key: string }>(
    db,
    `insert into idempotency (hotel_id, key, body_hash, status, response)
     values ($1,$2,$3,0,'{}'::jsonb)
     on conflict (hotel_id, key) do nothing
     returning key`,
    [hotelId, key, hash],
  );
  if (inserted) return { kind: 'reserved' };
  const existing = await one<{ body_hash: string; status: number; response: unknown }>(
    db,
    'select body_hash, status, response from idempotency where hotel_id = $1 and key = $2',
    [hotelId, key],
  );
  if (!existing) return { kind: 'inFlight' };
  if (existing.body_hash !== hash) return { kind: 'mismatch' };
  if (existing.status === 0) return { kind: 'inFlight' };
  return { kind: 'replay', status: existing.status, response: existing.response };
}

export async function storeResponse(
  db: Db,
  hotelId: string,
  key: string,
  status: number,
  response: unknown,
): Promise<void> {
  await db.query(
    'update idempotency set status = $3, response = $4 where hotel_id = $1 and key = $2',
    [hotelId, key, status, JSON.stringify(response)],
  );
}

export async function release(db: Db, hotelId: string, key: string): Promise<void> {
  await db.query('delete from idempotency where hotel_id = $1 and key = $2 and status = 0', [
    hotelId,
    key,
  ]);
}
