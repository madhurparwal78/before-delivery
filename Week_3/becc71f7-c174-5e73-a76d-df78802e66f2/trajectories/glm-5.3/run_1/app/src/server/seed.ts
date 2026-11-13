// Starting data (DP-53). S is the Brussels date of the first start; S-n dates are fixed then.

import crypto from 'node:crypto';
import type { Pool } from './db.js';
import { addDays, brusselsMidnight, brusselsDateOf, cutToSecond } from '../shared/time.js';

import { normaliseIban } from '../shared/iban.js';
import { tagCodeFromSequence } from '../shared/tagcode.js';

const OWNER = { name: 'Margaux', email: 'margaux@atelier-ourlet.example', password: 'ourlet-owner-2027' };
const SEED_MEMBERS = [
  OWNER,
  { name: 'Noor', email: 'noor@atelier-ourlet.example', password: 'ourlet-noor-2027' },
  { name: 'Jules', email: 'jules@atelier-ourlet.example', password: 'ourlet-jules-2027' },
  { name: 'Ines', email: 'ines@atelier-ourlet.example', password: 'ourlet-ines-2027' },
];

const SCRYPT_N = 16384, SCRYPT_r = 8, SCRYPT_p = 1, KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return `scrypt$${SCRYPT_N}$${hash.toString('base64')}$${salt.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(String(parts[3]), 'base64');
  const expected = Buffer.from(String(parts[2]), 'base64');
  const hash = crypto.scryptSync(password, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return crypto.timingSafeEqual(hash, expected);
}

export async function seed(pool: Pool): Promise<void> {
  const meta = await pool.query<{ key: string; value: string }>("SELECT key, value FROM shop_meta WHERE key = 'seeded_on'");
  if (meta.rows.length > 0) return;

  // Take the seed lock so concurrent starts of the same database each seed exactly once.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(918273645)');
    const existing = await client.query("SELECT value FROM shop_meta WHERE key = 'seeded_on' FOR UPDATE");
    if (existing.rows.length > 0) { await client.query('COMMIT'); return; }

    const s = brusselsDateOf(new Date());
    await seedAll(client, s);
    await client.query("INSERT INTO shop_meta (key, value) VALUES ('seeded_on', $1)", [s]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

type DbClient = import('pg').PoolClient;

async function seedAll(client: DbClient, s: string): Promise<void> {
  const now = new Date();

  // Ladder
  const ladderId = crypto.randomUUID();
  await client.query(
    `INSERT INTO ladders (id, effective_on, first_markdown_percent, first_markdown_day, second_markdown_percent, second_markdown_day, period_end_day)
     VALUES ($1, '2024-01-01', 25, 30, 50, 60, 90)`,
    [ladderId]
  );

  // Members
  const memberIds: Record<string, string> = {};
  for (const m of SEED_MEMBERS) {
    const id = crypto.randomUUID();
    memberIds[m.name] = id;
    await client.query(
      `INSERT INTO members (id, name, email, password_hash, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, m.name, m.email, hashPassword(m.password), roleFor(m), now]
    );
  }

  // Consignors
  const consignorIds: Record<string, string> = {};
  const consignors = [
    { name: 'Zo\u00EB \u00D8rsted-H\u00E6k', email: 'zoe.orsted@consignors.example', phone: '+32 470 11 22 33', iban: 'BE21 0012 3456 7803' },
    { name: 'S\u00E9gol\u00E8ne D\u2019Hondt', email: 'segolene.dhondt@consignors.example', phone: '+32 470 12 34 56', iban: 'BE35 3101 2345 6737' },
    { name: 'Maarten De Smet', email: 'maarten.desmet@consignors.example', phone: '+32 471 98 76 54', iban: 'BE94 7350 0123 4514' },
    { name: 'Lotte Janssens', email: 'lotte.janssens@consignors.example', phone: '+32 472 45 67 89', iban: 'BE68 5390 0754 7035' },
  ];
  for (const c of consignors) {
    const id = crypto.randomUUID();
    consignorIds[c.name] = id;
    await client.query(
      `INSERT INTO consignors (id, name, email, phone, iban, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
      [id, c.name, c.email, c.phone, normaliseIban(c.iban), now]
    );
  }

  // Pieces
  const P = (seq: number, consignor: string, category: string, brand: string, description: string,
             size: string, condition: string, asking: number, intake: string, status: string,
             choice: string | null = null, archivedAt: Date | null = null) => ({
    seq, consignor, category, brand, description, size, condition, asking, intake, status, choice, archivedAt,
  });

  const pieces = [
    P(1000042, 'Zo\u00EB \u00D8rsted-H\u00E6k', 'coats', 'Maison Arlo', 'Wool wrap coat, camel', 'm', 'very_good', 4990, addDays(s, -35), 'on_rail'),
    P(1000043, 'S\u00E9gol\u00E8ne D\u2019Hondt', 'dresses', 'Linnea', 'Silk slip dress, ink blue', 's', 'very_good', 1990, addDays(s, -3), 'on_rail'),
    P(1000044, 'Maarten De Smet', 'shoes', 'Calder & Fils', 'Leather Chelsea boots', '42', 'good', 12000, addDays(s, -65), 'on_rail'),
    P(1000045, 'Zo\u00EB \u00D8rsted-H\u00E6k', 'bags', 'Oriel', 'Leather shoulder bag, cognac', 'one_size', 'excellent', 31245, addDays(s, -20), 'sold'),
    P(1000046, 'Lotte Janssens', 'knitwear', 'Fjell', 'Merino cardigan, oatmeal', 'm', 'very_good', 3900, addDays(s, -80), 'on_rail'),
    P(1000047, 'S\u00E9gol\u00E8ne D\u2019Hondt', 'jackets', 'Atelier Nord', 'Denim trucker jacket', 'l', 'good', 4500, addDays(s, -92), 'returns_shelf', 'return'),
    P(1000048, 'Maarten De Smet', 'trousers', 'Pell', 'Pleated wool trousers, grey', 'm', 'good', 6500, addDays(s, -95), 'donation_box'),
    P(1000049, 'Zo\u00EB \u00D8rsted-H\u00E6k', 'skirts', 'Linnea', 'Pleated midi skirt, black', 's', 'excellent', 5500, addDays(s, -50), 'sold'),
    P(1000050, 'S\u00E9gol\u00E8ne D\u2019Hondt', 'shirts', 'Marlowe', 'Poplin shirt, white', 'm', 'very_good', 2990, addDays(s, -45), 'sold'),
    P(1000051, 'Maarten De Smet', 'accessories', 'Oriel', 'Silk scarf, rust print', 'one_size', 'excellent', 3500, addDays(s, -10), 'on_rail'),
    P(1000052, 'Lotte Janssens', 'coats', 'Fjell', 'Boiled wool coat, forest', 'l', 'good', 8900, addDays(s, -31), 'on_rail'),
    P(1000053, 'Zo\u00EB \u00D8rsted-H\u00E6k', 'shoes', 'Calder & Fils', 'Suede loafers', '38', 'very_good', 7500, addDays(s, -200), 'archived', null, now),
  ];

  for (const p of pieces) {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO pieces (id, tag_digits, consignor_id, category, brand, description, size, condition,
        asking_price_cents, intake_date, ladder_id, status, choice, archived_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [id, tagCodeFromSequence(p.seq).replace(/[^0-9]/g, ''), consignorIds[p.consignor]!, p.category, p.brand, p.description, p.size, p.condition,
       p.asking, p.intake, ladderId, p.status, p.choice, p.archivedAt, now]
    );
    // Price history from intake
    await client.query(
      `INSERT INTO price_history (piece_id, asking_price_cents, effective_from) VALUES ($1, $2, $3)`,
      [id, p.asking, brusselsMidnight(p.intake)]
    );
  }

  // Sales (prices in force at their instants)
  const sales = [
    { seq: 1000045, at: brusselsAt(s, -10, 14, 5), by: 'Noor', payment: 'card', price: 31245, share: 21872, commission: 9373, vat: 1627 },
    { seq: 1000050, at: brusselsAt(s, -12, 11, 30), by: 'Noor', payment: 'cash', price: 2243, share: 1346, commission: 897, vat: 156 },
    { seq: 1000049, at: brusselsAt(s, -40, 16, 20), by: 'Jules', payment: 'cash', price: 5500, share: 3300, commission: 2200, vat: 382 },
  ];
  for (const sale of sales) {
    const piece = await client.query<{ id: string; consignor_id: string }>(
      'SELECT id, consignor_id FROM pieces WHERE tag_digits = $1', [tagCodeFromSequence(sale.seq).replace(/[^0-9]/g, '')]
    );
    const pieceRow = piece.rows[0]!;
    const refundable = refundableUntilFor(sale.at);
    await client.query(
      `INSERT INTO sales (id, piece_id, sold_at, price_cents, consignor_share_cents, commission_cents, vat_cents, payment, sold_by, refundable_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [crypto.randomUUID(), pieceRow.id, sale.at, sale.price, sale.share, sale.commission, sale.vat,
       sale.payment, memberIds[sale.by]!, refundable]
    );
  }
}

function roleFor(m: (typeof SEED_MEMBERS)[number]): string {
  if (m === OWNER) return 'owner';
  if (m.name === 'Noor' || m.name === 'Jules') return 'assistant';
  return 'bookkeeper';
}

/** A Brussels wall-clock instant on date s offset by days, at hour:minute. */
function brusselsAt(s: string, dayOffset: number, hour: number, minute: number): Date {
  const date = addDays(s, dayOffset);
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const asUtc = Date.parse(`${date}T${hh}:${mm}:00Z`);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Brussels', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return cutToSecond(new Date(asUtc - (asLocal - asUtc)));
}

/** Refund window: 23:59:59 Brussels on the 14th day after the sale date (DP-28). */
export function refundableUntilFor(soldAt: Date): Date {
  const date = brusselsDateOf(soldAt);
  const day14 = addDays(date, 14);
  return brusselsEndOfDay(day14);
}

function brusselsEndOfDay(date: string): Date {
  const next = addDays(date, 1);
  const midnight = brusselsMidnight(next);
  return new Date(midnight.getTime() - 1000);
}

export function tagCodeOf(seq: number): string {
  return tagCodeFromSequence(seq);
}
