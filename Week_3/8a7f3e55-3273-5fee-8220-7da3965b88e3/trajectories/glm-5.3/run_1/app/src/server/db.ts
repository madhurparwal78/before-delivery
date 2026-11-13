import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Config } from './config.js';
import { hashPassword } from './passwords.js';

/** Anything that can run queries: the pool, a transaction client or the Db wrapper. */
export interface Querier {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[]): Promise<pg.QueryResult<T>>;
}

export type DbClient = Querier;

export class Db implements Querier {
  pool: pg.Pool;

  constructor(config: Config) {
    this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
  }

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
    return this.pool.query(sql, params) as Promise<pg.QueryResult<T>>;
  }

  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection already unwound */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

const SCHEMA_LOCK_ID = 7011;

/** Apply schema and seed idempotently, tolerating concurrent processes starting together. */
export async function setupDatabase(db: Db, config: Config): Promise<void> {
  const lock = await db.pool.connect();
  try {
    // A Postgres advisory lock serialises concurrent setups across processes.
    await lock.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_ID]);
    const schema = readFileSync(
      new URL('./schema.sql', import.meta.url),
      'utf8',
    );
    await lock.query(schema);
    await seed(lock, config);
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_ID]).catch(() => undefined);
    lock.release();
  }
}

async function seed(client: pg.PoolClient, _config: Config): Promise<void> {
  await client.query(
    "INSERT INTO agencies (id, name, time_zone, solo_threshold_minutes) VALUES ('tandem-hands', $1, $2, $3)\n" +
      'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, time_zone = EXCLUDED.time_zone, solo_threshold_minutes = EXCLUDED.solo_threshold_minutes',
    ['Tandem Hands Collective', 'America/Chicago', 60],
  );

  const orgs: Array<[string, string]> = [
    ['riverbend', 'Riverbend Regional Hospital'],
    ['maple-valley', 'Maple Valley School District'],
    ['harlan-court', 'Harlan County Court'],
  ];
  for (const [id, name] of orgs) {
    await client.query(
      'INSERT INTO organisations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
      [id, name],
    );
  }

  const contracts: Array<[string, string, number, number, number]> = [
    ['riverbend', 'riverbend', 120, 15, 20],
    ['maple-valley', 'maple-valley', 120, 15, 30],
    ['harlan-court', 'harlan-court', 120, 15, 15],
  ];
  for (const [id, orgId, minimum, increment, rotation] of contracts) {
    await client.query(
      'INSERT INTO contracts (id, org_id, minimum_minutes, increment_minutes, rotation_interval_minutes) VALUES ($1, $2, $3, $4, $5)\n' +
        'ON CONFLICT (id) DO UPDATE SET minimum_minutes = EXCLUDED.minimum_minutes, increment_minutes = EXCLUDED.increment_minutes, rotation_interval_minutes = EXCLUDED.rotation_interval_minutes',
      [id, orgId, minimum, increment, rotation],
    );
  }

  const rates: Array<[string, number, number, number]> = [
    ['riverbend', 9000, 1000, 67],
    ['maple-valley', 7850, 500, 70],
    ['harlan-court', 10500, 1500, 0],
  ];
  for (const [contractId, hourly, surcharge, mileage] of rates) {
    await client.query(
      'INSERT INTO contract_rates (contract_id, effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile)\n' +
        "VALUES ($1, DATE '2026-01-01', $2, $3, $4) ON CONFLICT (contract_id, effective_from) DO NOTHING",
      [contractId, hourly, surcharge, mileage],
    );
  }

  const password = hashPassword('relayline-demo-2026');
  const staff: Array<{ id: string; name: string; email: string; role: string; orgId: string | null; initials: string | null; phone: string | null; city: string | null; pay: number | null }> = [
    { id: 'dana-okafor', name: 'Dana Okafor', email: 'dana.okafor@tandemhands.example', role: 'coordinator', orgId: null, initials: null, phone: null, city: null, pay: null },
    { id: 'morgan-ellis', name: 'Morgan Ellis', email: 'morgan.ellis@tandemhands.example', role: 'billing_manager', orgId: null, initials: null, phone: null, city: null, pay: null },
    { id: 'lena-torres', name: 'Lena Torres', email: 'lena.torres@riverbend.example', role: 'requester', orgId: 'riverbend', initials: null, phone: null, city: null, pay: null },
    { id: 'sam-whitfield', name: 'Sam Whitfield', email: 'sam.whitfield@maplevalley.example', role: 'requester', orgId: 'maple-valley', initials: null, phone: null, city: null, pay: null },
    { id: 'ruth-adeyemi', name: 'Ruth Adeyemi', email: 'ruth.adeyemi@harlancourt.example', role: 'requester', orgId: 'harlan-court', initials: null, phone: null, city: null, pay: null },
    { id: 'jordan-reyes', name: 'Jordan Reyes', email: 'jordan.reyes@interpreters.example', role: 'interpreter', orgId: null, initials: 'JR', phone: '+1 555 010 0141', city: 'Fairbrook', pay: 5500 },
    { id: 'avery-chen', name: 'Avery Chen', email: 'avery.chen@interpreters.example', role: 'interpreter', orgId: null, initials: 'AC', phone: '+1 555 010 0142', city: 'Linden Park', pay: 5200 },
    { id: 'casey-morgan', name: 'Casey Morgan', email: 'casey.morgan@interpreters.example', role: 'interpreter', orgId: null, initials: 'CM', phone: '+1 555 010 0143', city: 'Oak Hollow', pay: 5000 },
    { id: 'riley-brooks', name: 'Riley Brooks', email: 'riley.brooks@interpreters.example', role: 'interpreter', orgId: null, initials: 'RB', phone: '+1 555 010 0144', city: 'Westmere', pay: 6500 },
    { id: 'taylor-nguyen', name: 'Taylor Nguyen', email: 'taylor.nguyen@interpreters.example', role: 'interpreter', orgId: null, initials: 'TN', phone: '+1 555 010 0145', city: 'Fairbrook', pay: 4800 },
    { id: 'quinn-halvorsen', name: 'Quinn Halvorsen', email: 'quinn.halvorsen@interpreters.example', role: 'interpreter', orgId: null, initials: 'QH', phone: '+1 555 010 0146', city: 'Cedar Bluff', pay: 6200 },
    { id: 'sasha-lindqvist', name: 'Sasha Lindqvist', email: 'sasha.lindqvist@interpreters.example', role: 'interpreter', orgId: null, initials: 'SL', phone: '+1 555 010 0147', city: 'Granite Falls', pay: 6300 },
  ];
  for (const person of staff) {
    await client.query(
      'INSERT INTO users (id, name, email, password_hash, role, org_id, initials, phone, home_city, pay_rate_cents)\n' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)\n' +
        'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role,\n' +
        'org_id = EXCLUDED.org_id, initials = EXCLUDED.initials, phone = EXCLUDED.phone,\n' +
        'home_city = EXCLUDED.home_city, pay_rate_cents = EXCLUDED.pay_rate_cents',
      [person.id, person.name, person.email, password, person.role, person.orgId, person.initials, person.phone, person.city, person.pay],
    );
  }

  const credentials: Array<[string, string, string]> = [
    ['jordan-reyes', 'NIC', '2028-06-30'],
    ['avery-chen', 'NIC', '2027-12-31'],
    ['avery-chen', 'EIPA', '2027-08-31'],
    ['casey-morgan', 'BEI', '2028-03-31'],
    ['riley-brooks', 'NIC', '2028-12-31'],
    ['riley-brooks', 'SC:L', '2028-12-31'],
    ['taylor-nguyen', 'NIC', '2026-01-31'],
    ['taylor-nguyen', 'EIPA', '2027-05-31'],
    ['quinn-halvorsen', 'NIC', '2029-01-31'],
    ['quinn-halvorsen', 'SC:L', '2029-01-31'],
    ['sasha-lindqvist', 'SC:L', '2028-09-30'],
  ];
  for (const [interpreterId, code, expires] of credentials) {
    await client.query(
      'INSERT INTO interpreter_credentials (interpreter_id, code, expires_on) VALUES ($1, $2, $3)\n' +
        'ON CONFLICT (interpreter_id, code, expires_on) DO NOTHING',
      [interpreterId, code, expires],
    );
  }

  await client.query('INSERT INTO booking_sequence (id, last_value) VALUES (1, 1000) ON CONFLICT (id) DO NOTHING');
  await client.query("INSERT INTO line_sequence (id, last_value) VALUES (1, 5000) ON CONFLICT (id) DO NOTHING");
}

/** Wait for Postgres, retrying every few seconds, then apply schema and seed. */
export async function waitForDatabase(db: Db, config: Config): Promise<void> {
  for (;;) {
    try {
      await setupDatabase(db, config);
      return;
    } catch (err) {
      console.error('Postgres not ready, retrying:', err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}
