// The store: every SQL statement the app runs, arranged by domain rule. All
// concurrency rules are decided by Postgres constraints and conditional updates,
// never by checks in application memory.
import { Database, type Row, type Tx } from './db.js';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { parseHold, parseUnit, queueIndexUpdate, runLapseCheck, type HoldRow, type UnitRow } from '../domain/units.js';
import { BAND_IDS, STACK_BEARINGS, STACK_META, areaSqft, bandForFloor, facingForBearing, priceFor, unitCode, viewFor, type BandId, type Stack } from '../domain/shared.js';
import type { AppClock } from '../clock.js';

export interface Account {
  id: string;
  email: string;
  name: string;
  role: 'buyer' | 'coordinator';
  passwordHash: string;
}

export class Store {
  constructor(private readonly db: Database, private readonly clock: AppClock) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  // ---------- accounts and sessions ----------

  async accountByEmail(email: string): Promise<Account | null> {
    const result = await this.db.query('SELECT id, email, name, role, password_hash FROM accounts WHERE email = $1', [email]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: String(row.id), email: String(row.email), name: String(row.name), role: String(row.role) as Account['role'], passwordHash: String(row.password_hash) };
  }

  async accountById(id: string): Promise<Account | null> {
    const result = await this.db.query('SELECT id, email, name, role, password_hash FROM accounts WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: String(row.id), email: String(row.email), name: String(row.name), role: String(row.role) as Account['role'], passwordHash: String(row.password_hash) };
  }

  async createAccount(name: string, email: string, password: string): Promise<void> {
    const id = crypto.randomUUID();
    const hash = hashPassword(password);
    await this.db.query(
      'INSERT INTO accounts (id, email, name, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email) DO NOTHING',
      [id, email, name, hash, 'buyer', this.clock.nowIso()],
    );
  }

  async createSession(accountId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(this.clock.now() + this.sessionSeconds() * 1000).toISOString();
    await this.db.query('INSERT INTO sessions (token, account_id, expires_at) VALUES ($1, $2, $3)', [token, accountId, expires]);
    return token;
  }

  async sessionAccount(token: string): Promise<Account | null> {
    const result = await this.db.query(
      `SELECT a.id, a.email, a.name, a.role, a.password_hash FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.token = $1 AND s.expires_at > $2`,
      [token, this.clock.nowIso()],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: String(row.id), email: String(row.email), name: String(row.name), role: String(row.role) as Account['role'], passwordHash: String(row.password_hash) };
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  // ---------- units ----------

  async unitByCode(code: string): Promise<UnitRow | null> {
    const result = await this.db.query('SELECT * FROM units WHERE code = $1', [code]);
    return result.rows.length === 0 ? null : parseUnit(result.rows[0]);
  }

  async allUnits(): Promise<UnitRow[]> {
    const result = await this.db.query('SELECT * FROM units ORDER BY floor, stack');
    return result.rows.map(parseUnit);
  }

  async availableCount(): Promise<number> {
    const now = this.clock.nowIso();
    return this.db.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const result = await tx.query(`SELECT count(*)::int AS c FROM units WHERE released AND NOT withdrawn AND status = 'available'`);
      return Number(result.rows[0].c);
    });
  }

  // ---------- holds ----------

  async holdsForAccount(accountId: string): Promise<HoldRow[]> {
    const now = this.clock.nowIso();
    return this.db.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const result = await tx.query('SELECT * FROM holds WHERE account_id = $1 ORDER BY created_at DESC', [accountId]);
      return result.rows.map(parseHold);
    });
  }

  async holdById(id: string, accountId: string): Promise<HoldRow | null> {
    const now = this.clock.nowIso();
    return this.db.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const result = await tx.query('SELECT * FROM holds WHERE id = $1 AND account_id = $2', [id, accountId]);
      return result.rows.length === 0 ? null : parseHold(result.rows[0]);
    });
  }

  async activeHoldForAccount(accountId: string): Promise<HoldRow | null> {
    const now = this.clock.nowIso();
    return this.db.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const result = await tx.query(`SELECT * FROM holds WHERE account_id = $1 AND status = 'active'`, [accountId]);
      return result.rows.length === 0 ? null : parseHold(result.rows[0]);
    });
  }

  async activeHoldForUnit(code: string): Promise<HoldRow | null> {
    const now = this.clock.nowIso();
    return this.db.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const result = await tx.query(`SELECT * FROM holds WHERE unit_code = $1 AND status = 'active'`, [code]);
      return result.rows.length === 0 ? null : parseHold(result.rows[0]);
    });
  }

  // ---------- pending index updates ----------

  async pendingUpdateUnits(): Promise<string[]> {
    const result = await this.db.query('SELECT DISTINCT unit_code FROM pending_index_updates');
    return result.rows.map((r) => String(r.unit_code));
  }

  async clearPendingUpdates(unitCode: string): Promise<void> {
    await this.db.query('DELETE FROM pending_index_updates WHERE unit_code = $1', [unitCode]);
  }

  // ---------- schema ----------

  async schemaReady(): Promise<boolean> {
    try {
      const result = await this.db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'units' LIMIT 1`);
      return result.rows.length > 0;
    } catch {
      return false;
    }
  }

  async applySchema(ddl: string): Promise<void> {
    await this.db.query(ddl);
  }

  private sessionSeconds(): number {
    return Number(process.env.SESSION_SECONDS ?? 1209600);
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(parts[2], 'base64url');
  const derived = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(derived, expected);
}

export function md5Of(data: Buffer): string {
  return createHash('md5').update(data).digest('hex');
}
