import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from './config.js';
import { KitchenClock } from './domain/kitchen.js';
import { hashPassword, newId } from './domain/crypto.js';

const STATIONS: ReadonlyArray<{ id: string; name: string; kind: 'range' | 'prep_table' | 'mixer' | 'cooler_shelf'; col: number; row: number }> = [
  { id: 'range-1', name: 'Range 1', kind: 'range', col: 0, row: 0 },
  { id: 'range-2', name: 'Range 2', kind: 'range', col: 1, row: 0 },
  { id: 'range-3', name: 'Range 3', kind: 'range', col: 2, row: 0 },
  { id: 'prep-a', name: 'Prep Table A', kind: 'prep_table', col: 0, row: 1 },
  { id: 'prep-b', name: 'Prep Table B', kind: 'prep_table', col: 1, row: 1 },
  { id: 'mixer-60', name: 'Mixer 60 qt', kind: 'mixer', col: 2, row: 1 },
  { id: 'mixer-20', name: 'Mixer 20 qt', kind: 'mixer', col: 3, row: 1 },
  { id: 'shelf-1', name: 'Walk-in Shelf 1', kind: 'cooler_shelf', col: 0, row: 2 },
  { id: 'shelf-2', name: 'Walk-in Shelf 2', kind: 'cooler_shelf', col: 1, row: 2 },
  { id: 'shelf-3', name: 'Walk-in Shelf 3', kind: 'cooler_shelf', col: 2, row: 2 },
];

const STAFF: ReadonlyArray<{ email: string; password: string; name: string; role: 'owner' | 'shift_lead' }> = [
  { email: 'owner@stationhouse.test', password: 'owner-pass-2026', name: 'Imani Ferro', role: 'owner' },
  { email: 'lead@stationhouse.test', password: 'lead-pass-2026', name: 'Theo Park', role: 'shift_lead' },
];

interface TenantSeed {
  business: string; contact: string; email: string;
  status: 'applied' | 'documents_pending' | 'approved' | 'suspended';
  suspendedReason: string | null;
  insuranceExpires: string | null; foodHandlerExpires: string | null;
}

const TENANT_PASSWORD = 'tenant-pass-2026';

export function buildSeed(clock: KitchenClock, now: number): { sql: Array<{ text: string; params: unknown[] }> } {
  const todayKey = clock.dateKey(now);
  const day = (offset: number): string => clock.addDaysKey(todayKey, offset);
  const tenants: TenantSeed[] = [
    { business: 'Bright Fork Catering', contact: 'Dana Okafor', email: 'dana@brightfork.test', status: 'approved', suspendedReason: null, insuranceExpires: day(200), foodHandlerExpires: day(200) },
    { business: "Tío Lalo's Tacos", contact: 'Lalo Medina', email: 'lalo@tiolalo.test', status: 'approved', suspendedReason: null, insuranceExpires: day(200), foodHandlerExpires: day(200) },
    { business: 'Crumb & Kettle Bakery', contact: 'Pearl Asante', email: 'pearl@crumbkettle.test', status: 'approved', suspendedReason: null, insuranceExpires: day(2), foodHandlerExpires: day(200) },
    { business: 'Saltbox Provisions', contact: 'June Harrow', email: 'june@saltbox.test', status: 'approved', suspendedReason: null, insuranceExpires: day(0), foodHandlerExpires: day(200) },
    { business: 'Night Market Dumplings', contact: 'Wei Lindqvist', email: 'wei@nightmarket.test', status: 'suspended', suspendedReason: 'insurance_lapsed', insuranceExpires: day(-1), foodHandlerExpires: day(200) },
    { business: 'Copper Pot Jams', contact: 'Sam Whitlock', email: 'sam@copperpot.test', status: 'documents_pending', suspendedReason: null, insuranceExpires: day(200), foodHandlerExpires: day(200) },
    { business: 'Fennel & Fig', contact: 'Ari Castellanos', email: 'ari@fennelfig.test', status: 'applied', suspendedReason: null, insuranceExpires: null, foodHandlerExpires: null },
  ];

  const statements: Array<{ text: string; params: unknown[] }> = [];
  const stmt = (text: string, params: unknown[]): void => { statements.push({ text, params }); };

  for (const s of STATIONS) {
    stmt(
      `INSERT INTO stations (id, name, kind, cleanup_minutes, col, row, seed_order)
       VALUES ($1,$2,$3,30,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.name, s.kind, s.col, s.row, STATIONS.indexOf(s)],
    );
  }

  const tenantRows: Array<{ tenantId: string; userId: string; seed: TenantSeed }> = [];

  for (const s of STAFF) {
    const id = newId();
    const { hash, salt } = hashPassword(s.password);
    stmt(
      `INSERT INTO users (id, email, password_hash, password_salt, role, display_name, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (email) DO NOTHING`,
      [id, s.email, hash, salt, s.role, s.name, now],
    );
  }

  for (const t of tenants) {
    const userId = newId();
    const tenantId = newId();
    const { hash, salt } = hashPassword(TENANT_PASSWORD);
    stmt(
      `INSERT INTO users (id, email, password_hash, password_salt, role, display_name, created_at)
       VALUES ($1,$2,$3,$4,'tenant',$5,$6)
       ON CONFLICT (email) DO NOTHING`,
      [userId, t.email, hash, salt, t.contact, now],
    );
    stmt(
      `INSERT INTO tenants (id, user_id, business_name, contact_name, status, suspended_reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, userId, t.business, t.contact, t.status, t.suspendedReason, now],
    );
    tenantRows.push({ tenantId, userId, seed: t });
  }

  for (const row of tenantRows) {
    const docs: Array<[string, string | null]> = [
      ['insurance_certificate', row.seed.insuranceExpires],
      ['food_handler_card', row.seed.foodHandlerExpires],
    ];
    for (const [kind, expires] of docs) {
      if (expires === null) continue;
      const isInsurance = kind === 'insurance_certificate';
      stmt(
        `INSERT INTO documents (id, tenant_id, kind, expires_on, per_occurrence_limit, additional_insured, has_file, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,false,$7)
         ON CONFLICT DO NOTHING`,
        [newId(), row.tenantId, kind, expires, isInsurance ? 1000000 : null, isInsurance ? true : null, now],
      );
    }
  }

  return { sql: statements };
}

export async function applySchema(db: pg.Pool, config: Config): Promise<void> {
  const clock = new KitchenClock(config.kitchenTimeZone);
  const now = Date.now();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
    const schemaSql: string = await fs.promises.readFile(schemaPath, 'utf8');
    await client.query(schemaSql);
    // Lock after the schema exists, so concurrent booting processes serialise
    // their seeding.
    await client.query('LOCK TABLE users, tenants, stations, bookings, packs, movements, ledger_entries, documents, purchase_attempts, door_log, idempotency_keys, mail_queue, notice_claims, sessions, sign_in_attempts, counted_claims IN ACCESS EXCLUSIVE MODE');
    // A second process starting against a seeded database adds nothing.
    const already = await client.query(`SELECT 1 FROM users WHERE email='owner@stationhouse.test' LIMIT 1`);
    if (already.rows.length === 0) {
      const { sql } = buildSeed(clock, now);
      for (const statement of sql) {
        await client.query(statement.text, statement.params);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
