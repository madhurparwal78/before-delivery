import { randomUUID, scryptSync } from 'node:crypto';

import type { TransactionRunner } from './pool.js';

export const KITCHEN_NAME = 'Halsted Street Kitchen';
const SEED_PASSWORD = 'prep-shift-2026';

interface SeedStation {
  id: string;
  name: string;
  hourly_rate_cents: number;
  cleaning_minutes: number;
}

export const SEED_STATIONS: readonly SeedStation[] = [
  { id: 'oven-1', name: 'Convection Oven 1', hourly_rate_cents: 2800, cleaning_minutes: 30 },
  { id: 'oven-2', name: 'Deck Oven', hourly_rate_cents: 2600, cleaning_minutes: 30 },
  { id: 'kettle-1', name: 'Steam Kettle', hourly_rate_cents: 3200, cleaning_minutes: 45 },
  { id: 'prep-a', name: 'Prep Station A', hourly_rate_cents: 1800, cleaning_minutes: 15 },
  { id: 'prep-b', name: 'Prep Station B', hourly_rate_cents: 1800, cleaning_minutes: 15 },
  { id: 'cold-1', name: 'Walk-in Shelf 1', hourly_rate_cents: 600, cleaning_minutes: 0 },
];

const SEED_PACKS = [
  { id: 'pack-10', name: '10-hour pack', minutes: 600, price_cents: 23000 },
  { id: 'pack-25', name: '25-hour pack', minutes: 1500, price_cents: 52500 },
] as const;

const SEED_MEMBERS = [
  { id: 'mbr-rosa', business_name: "Rosa's Tamal Cart", contact_email: 'rosa@tamalcart.test' },
  { id: 'mbr-crumb', business_name: 'Northside Crumb Co.', contact_email: 'owen@crumbco.test' },
  { id: 'mbr-lake', business_name: 'Lakefront Meal Prep', contact_email: 'priya@lakefrontprep.test' },
] as const;

const SEED_USERS = [
  { id: 'usr-ines', role: 'operator', name: 'Ines Albrecht', email: 'ines@halsted-kitchen.test', member_id: null },
  { id: 'usr-rosa', role: 'member', name: 'Rosa Delgado', email: 'rosa@tamalcart.test', member_id: 'mbr-rosa' },
  { id: 'usr-owen', role: 'member', name: 'Owen Mbeki', email: 'owen@crumbco.test', member_id: 'mbr-crumb' },
  { id: 'usr-priya', role: 'member', name: 'Priya Natarajan', email: 'priya@lakefrontprep.test', member_id: 'mbr-lake' },
  { id: 'usr-tomas', role: 'crew_cook', name: 'Tomás Reyes', email: 'tomas@tamalcart.test', member_id: 'mbr-rosa' },
  { id: 'usr-lena', role: 'crew_cook', name: 'Lena Park', email: 'lena@tamalcart.test', member_id: 'mbr-rosa' },
  { id: 'usr-abe', role: 'crew_cook', name: 'Abe Lindqvist', email: 'abe@crumbco.test', member_id: 'mbr-crumb' },
] as const;

const SEED_DOCUMENTS = [
  { id: 'doc-rosa-coi', member_id: 'mbr-rosa', kind: 'liability_insurance', crew_cook_id: null, expires_on: '2030-12-31' },
  { id: 'doc-crumb-coi', member_id: 'mbr-crumb', kind: 'liability_insurance', crew_cook_id: null, expires_on: '2030-12-31' },
  { id: 'doc-lake-coi', member_id: 'mbr-lake', kind: 'liability_insurance', crew_cook_id: null, expires_on: '2026-09-30' },
  { id: 'doc-tomas-card', member_id: 'mbr-rosa', kind: 'food_handler_card', crew_cook_id: 'usr-tomas', expires_on: '2030-06-30' },
  { id: 'doc-lena-card', member_id: 'mbr-rosa', kind: 'food_handler_card', crew_cook_id: 'usr-lena', expires_on: '2026-08-31' },
  { id: 'doc-abe-card', member_id: 'mbr-crumb', kind: 'food_handler_card', crew_cook_id: 'usr-abe', expires_on: '2030-06-30' },
] as const;

const SEED_OPENING_BALANCES = [
  { id: 'txn-open-rosa', member_id: 'mbr-rosa', minutes: 360 },
  { id: 'txn-open-lake', member_id: 'mbr-lake', minutes: 600 },
] as const;

export function documentStorageKey(memberId: string, documentId: string): string {
  return `documents/${memberId}/${documentId}`;
}

/** scrypt with a per-user salt, so a re-run produces the same stored hash. */
export function hashPassword(userId: string, password: string): string {
  return scryptSync(password, `passboard:${userId}`, 32).toString('hex');
}

export function verifyPassword(userId: string, password: string, stored: string): boolean {
  const candidate = hashPassword(userId, password);
  return candidate.length === stored.length && candidate === stored;
}

export interface SeededDocument {
  id: string;
  member_id: string;
  storage_key: string;
  label: string;
}

export function seededDocuments(): SeededDocument[] {
  return SEED_DOCUMENTS.map((document) => {
    const member = SEED_MEMBERS.find((candidate) => candidate.id === document.member_id);
    const cook = SEED_USERS.find((candidate) => candidate.id === document.crew_cook_id);
    const kindLabel =
      document.kind === 'liability_insurance' ? 'Liability insurance' : 'Food handler card';
    return {
      id: document.id,
      member_id: document.member_id,
      storage_key: documentStorageKey(document.member_id, document.id),
      label: `${kindLabel} — ${member?.business_name ?? document.member_id}${
        cook ? ` — ${cook.name}` : ''
      } — expires ${document.expires_on}`,
    };
  });
}

/**
 * Applies seed data idempotently. Reference rows are kept in step with this
 * file; records the product creates at runtime are never touched.
 */
export async function applySeed(runner: TransactionRunner, now: Date): Promise<void> {
  await runner(async (client) => {
    for (const [index, station] of SEED_STATIONS.entries()) {
      await client.query(
        `INSERT INTO stations (id, name, hourly_rate_cents, cleaning_minutes, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
           hourly_rate_cents = EXCLUDED.hourly_rate_cents,
           cleaning_minutes = EXCLUDED.cleaning_minutes,
           sort_order = EXCLUDED.sort_order`,
        [station.id, station.name, station.hourly_rate_cents, station.cleaning_minutes, index],
      );
    }

    for (const [index, pack] of SEED_PACKS.entries()) {
      await client.query(
        `INSERT INTO packs (id, name, minutes, price_cents, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, minutes = EXCLUDED.minutes,
           price_cents = EXCLUDED.price_cents, sort_order = EXCLUDED.sort_order`,
        [pack.id, pack.name, pack.minutes, pack.price_cents, index],
      );
    }

    for (const member of SEED_MEMBERS) {
      await client.query(
        `INSERT INTO members (id, business_name, contact_email) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [member.id, member.business_name, member.contact_email],
      );
    }

    for (const user of SEED_USERS) {
      await client.query(
        `INSERT INTO users (id, role, name, email, password_hash, member_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name,
           email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
           member_id = EXCLUDED.member_id`,
        [user.id, user.role, user.name, user.email, hashPassword(user.id, SEED_PASSWORD), user.member_id],
      );
    }

    for (const document of SEED_DOCUMENTS) {
      await client.query(
        `INSERT INTO documents (id, member_id, kind, crew_cook_id, expires_on, status, filename,
            content_type, size_bytes, storage_key, uploaded_at, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, 'approved', $6, 'application/pdf', 0, $7, $8, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          document.id,
          document.member_id,
          document.kind,
          document.crew_cook_id,
          document.expires_on,
          `${document.id}.pdf`,
          documentStorageKey(document.member_id, document.id),
          now,
        ],
      );
    }

    for (const opening of SEED_OPENING_BALANCES) {
      const inserted = await client.query(
        `INSERT INTO ledger_transactions (id, member_id, kind, created_at)
         VALUES ($1, $2, 'opening', $3) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [opening.id, opening.member_id, now],
      );
      if (inserted.rowCount === 1) {
        await client.query(
          `INSERT INTO ledger_entries (transaction_id, account, minutes)
           VALUES ($1, $2, $3), ($1, 'kitchen:issued', $4)`,
          [opening.id, `member:${opening.member_id}`, opening.minutes, -opening.minutes],
        );
      }
    }
  });
}

/** Record ids are unique across every copy of the app that shares a service. */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
