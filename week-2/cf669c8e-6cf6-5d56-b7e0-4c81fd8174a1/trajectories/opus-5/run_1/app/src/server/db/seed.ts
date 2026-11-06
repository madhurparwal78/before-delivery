/**
 * Schema and seed application, idempotent on every serve.
 *
 * Seeding runs once per database under an advisory lock, so several instances
 * starting at once leave one set of users, one callback secret and one set of
 * test-ride slots.
 */

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

import { SEED_USERS } from '../../shared/seed.js';
import { addDays, amsterdamDate, dayOfWeek, instantAtAmsterdamWallTime, parseIsoDate } from '../domain/clock.js';
import { SCHEMA_LOCK_KEY, SCHEMA_SQL } from './schema.js';
import { query, withAdvisoryLock } from './pool.js';

const SCRYPT_KEY_LENGTH = 64;

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): {
  hash: string;
  salt: string;
} {
  return { hash: scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex'), salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === candidate.length && timingSafeEqual(candidate, stored);
}

const SLOT_TIMES = ['10:00', '13:00', '16:00'];
const SEEDED_SLOT_BIKES = ['BK-KADE-25', 'BK-DIJK-45'];
const SINGLE_SLOT_BIKE = 'BK-POLDER-45';
const SLOT_DAYS = 14;
const SUNDAY = 0;

async function markerTaken(name: string): Promise<boolean> {
  const inserted = await query(
    'INSERT INTO seed_markers(name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING name',
    [name],
  );
  return inserted.rowCount === 0;
}

async function seedUsers(): Promise<void> {
  for (const user of SEED_USERS) {
    const { hash, salt } = hashPassword(user.password);
    await query(
      `INSERT INTO users(id, email, password_hash, password_salt, name, country, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), user.email, hash, salt, user.name, user.country, user.role],
    );
  }
}

async function insertSlot(bikeId: string, date: string, time: string): Promise<void> {
  const [hour, minute] = time.split(':').map(Number);
  const { year, month, day } = parseIsoDate(date);
  const startsAt = instantAtAmsterdamWallTime(year, month, day, hour as number, minute as number, 0);
  if (!startsAt) return;
  await query(
    `INSERT INTO bike_slots(id, bike_id, starts_at, local_date, local_time)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (bike_id, starts_at) DO NOTHING`,
    [randomUUID(), bikeId, startsAt.toISOString(), date, time],
  );
}

/**
 * Slots at 10:00, 13:00 and 16:00 on each of the 14 calendar days starting
 * with the shop clock's today, skipping Sundays, plus one 10:00 slot for the
 * single-slot bike on the first non-Sunday after today.
 */
async function seedSlots(): Promise<void> {
  const today = amsterdamDate();

  for (let offset = 0; offset < SLOT_DAYS; offset += 1) {
    const date = addDays(today, offset);
    if (dayOfWeek(date) === SUNDAY) continue;
    for (const bikeId of SEEDED_SLOT_BIKES) {
      for (const time of SLOT_TIMES) await insertSlot(bikeId, date, time);
    }
  }

  let date = addDays(today, 1);
  while (dayOfWeek(date) === SUNDAY) date = addDays(date, 1);
  await insertSlot(SINGLE_SLOT_BIKE, date, '10:00');
}

/** The callback secret: a random value of at least 32 characters, once per database. */
export async function ensureCallbackSecret(): Promise<string> {
  const existing = await query<{ value: string }>(
    'SELECT value FROM shop_secrets WHERE name = $1',
    ['killbill_callback'],
  );
  const found = existing.rows[0];
  if (found) return found.value;

  const secret = randomBytes(32).toString('hex');
  await query(
    'INSERT INTO shop_secrets(name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
    ['killbill_callback', secret],
  );
  const after = await query<{ value: string }>('SELECT value FROM shop_secrets WHERE name = $1', [
    'killbill_callback',
  ]);
  const row = after.rows[0];
  if (!row) throw new Error('callback secret could not be stored');
  return row.value;
}

export async function applySchemaAndSeed(): Promise<void> {
  await withAdvisoryLock(SCHEMA_LOCK_KEY, async () => {
    await query(SCHEMA_SQL);
    await seedUsers();
    if (!(await markerTaken('slots'))) await seedSlots();
    await ensureCallbackSecret();
  });
}
