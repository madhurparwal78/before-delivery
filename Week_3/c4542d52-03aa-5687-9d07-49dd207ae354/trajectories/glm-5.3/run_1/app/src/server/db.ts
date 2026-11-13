import { Pool, type PoolClient } from 'pg';
import crypto from 'node:crypto';
import { loadConfig, readAsset } from './config.js';
import { serverDate } from './time.js';
import { types } from 'pg';

// `date` columns (OID 1082) are calendar dates on the register, not instants:
// parse them as plain YYYY-MM-DD strings so no time zone can ever shift them.
types.setTypeParser(1082, (v: string) => v);

export const pool = new Pool({ connectionString: loadConfig().databaseUrl, max: 25 });

export interface PersonRow {
  id: string;
  name: string;
  first_name: string;
  email: string;
  role: string;
  access: string;
  terminated_at: Date | null;
  termination_date: string | null;
  window_ends_at: Date | null;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 32).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

export async function applySchema(): Promise<void> {
  const schema = readAsset('src/server/schema.sql').toString('utf8');
  await pool.query(schema);
}

let seedTimeCache: Date | null = null;

/** Seeds only an empty register, idempotently. */
export async function seed(): Promise<{ seeded: boolean; seedTime: Date }> {
  if (seedTimeCache) return { seeded: false, seedTime: seedTimeCache };
  const existing = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM people');
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    const r = await pool.query<{ offered_at: Date }>(
      "SELECT offered_at FROM grants WHERE id = 'TC-OPT-0011'",
    );
    seedTimeCache = r.rows[0]?.offered_at ?? new Date();
    return { seeded: false, seedTime: seedTimeCache };
  }
  const now = new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedRegister(client, now);
    await client.query('COMMIT');
    seedTimeCache = now;
    return { seeded: true, seedTime: now };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const PASSWORD = 'Tidecraft-demo-2026';

async function seedRegister(client: PoolClient, now: Date): Promise<void> {
  const cfg = loadConfig();
  const pwd = hashPassword(PASSWORD);
  const people: Array<[string, string, string, string, string, string]> = [
    ['PER-001', 'Mara Okafor', 'Mara', 'mara@tidecraft.example', 'founder_admin', 'active'],
    ['PER-002', 'Anselm Kowalczyk', 'Anselm', 'anselm@tidecraft.example', 'option_holder', 'none'],
    ['PER-003', 'Juniper Vance', 'Juniper', 'juniper@tidecraft.example', 'option_holder', 'active'],
    ['PER-004', 'Kenji Moreau', 'Kenji', 'kenji@tidecraft.example', 'option_holder', 'active'],
    ['PER-005', 'Rafael Ostrowski', 'Rafael', 'rafael@tidecraft.example', 'leaver', 'active'],
    ['PER-006', 'Larkspur Ventures Fund II', 'Larkspur', 'larkspur@larkspur.example', 'investor', 'active'],
    ['PER-007', 'Brightwater Angels LLC', 'Brightwater', 'brightwater@brightwater.example', 'investor', 'active'],
    ['PER-008', 'Priya Natarajan', 'Priya', 'priya@tidecraft.example', 'board_member', 'active'],
    ['PER-009', 'Theo Blackwood', 'Theo', 'theo@tidecraft.example', 'board_member', 'active'],
    ['PER-010', 'Wen Castellanos', 'Wen', 'wen@tidecraft.example', 'board_member', 'active'],
    ['PER-011', 'Harbourline Secondary Partners', 'Harbourline', 'harbourline@harbourline.example', 'investor', 'none'],
  ];
  for (const [id, name, first, email, role, access] of people) {
    await client.query(
      'INSERT INTO people (id, name, first_name, email, password_hash, role, access) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, name, first, email, pwd, role, access],
    );
  }
  const holdings: Array<[string, string, number]> = [
    ['PER-001', 'Common', 4_000_000],
    ['PER-002', 'Common', 2_000_000],
    ['PER-006', 'Series A Preferred', 1_500_000],
    ['PER-007', 'Series Seed Preferred', 300_000],
  ];
  for (const [person, klass, shares] of holdings) {
    await client.query('INSERT INTO share_holdings (person_id, class, shares) VALUES ($1,$2,$3)', [person, klass, shares]);
  }
  await client.query('INSERT INTO option_pool (id, authorized) VALUES (1, 1000000)');

  const grants: Array<[string, string, number, string, string, string, string, Date | null, Date | null]> = [
    ['TC-OPT-0004', 'PER-005', 24_000, '0.2210', 'standard', '2021-06-30', 'accepted', null, null],
    ['TC-OPT-0007', 'PER-003', 48_000, '0.4185', 'standard', '2025-01-31', 'accepted', null, null],
    ['TC-OPT-0011', 'PER-004', 12_000, '0.6120', 'standard', '2026-11-02', 'offered', now, new Date(now.getTime() + cfg.offerWindowSeconds * 1000)],
  ];
  for (const [id, holder, options, strike, vtype, vstart, state, offered, expires] of grants) {
    await client.query(
      `INSERT INTO grants (id, holder_id, options, strike, vesting_type, vesting_start, state, offered_at, offer_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, holder, options, strike, vtype, vstart, state, offered, expires],
    );
  }
  // TC-OPT-0011 votes (approved by the board) and Rafael's departure at seed time.
  await client.query('INSERT INTO grant_votes VALUES ($1,$2,$3)', ['TC-OPT-0011', 'PER-008', 'approve']);
  await client.query('INSERT INTO grant_votes VALUES ($1,$2,$3)', ['TC-OPT-0011', 'PER-009', 'approve']);

  const windowEnds = new Date(now.getTime() + cfg.leaverWindowSeconds * 1000);
  await client.query(
    'UPDATE people SET role = $1, terminated_at = $2, termination_date = $3, window_ends_at = $4 WHERE id = $5',
    ['leaver', now, serverDate(now), windowEnds, 'PER-005'],
  );

  const valuations: Array<[string, string, string, string, string]> = [
    ['VAL-01', '2024-12-01', '2025-11-30', '0.4185', 'Marrowgate Valuation Partners'],
    ['VAL-02', '2026-10-01', '2027-09-30', '0.6120', 'Marrowgate Valuation Partners'],
  ];
  for (const [id, eff, exp, fmv, firm] of valuations) {
    await client.query(
      'INSERT INTO valuations (id, effective_on, expires_on, fmv_per_share, firm) VALUES ($1,$2,$3,$4,$5)',
      [id, eff, exp, fmv, firm],
    );
  }

  // Ledger: one issuance entry per seeded holding, one grant_accepted entry per accepted grant.
  let ledgerSeq = 0;
  const nextLedger = () => `LED-${String(++ledgerSeq).padStart(6, '0')}`;
  for (const [person, klass, shares] of holdings) {
    const name = people.find((p) => p[0] === person)![1];
    await client.query(
      `INSERT INTO securities_ledger (id, holder_id, holder_name, kind, class, shares_delta, options_delta, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [nextLedger(), person, name, 'issuance', klass, shares, 0, 'Seed issuance'],
    );
  }
  for (const gid of ['TC-OPT-0004', 'TC-OPT-0007']) {
    const g = grants.find((x) => x[0] === gid)!;
    const name = people.find((p) => p[0] === g[1])![1];
    await client.query(
      `INSERT INTO securities_ledger (id, holder_id, holder_name, kind, class, shares_delta, options_delta, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [nextLedger(), g[1], name, 'grant_accepted', 'Options', 0, g[2], gid],
    );
  }
}
