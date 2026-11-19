import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaCandidates = [
  path.join(__dirname, 'schema.sql'),
  path.join(__dirname, '..', 'src', 'server', 'schema.sql'),
  path.join(process.cwd(), 'src', 'server', 'schema.sql'),
];

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

let schemaApplied = false;

export async function applySchema(): Promise<void> {
  if (schemaApplied) return;
  let sql: string | null = null;
  for (const candidate of schemaCandidates) {
    if (fs.existsSync(candidate)) {
      sql = fs.readFileSync(candidate, 'utf8');
      break;
    }
  }
  if (sql === null) throw new Error('schema.sql not found');
  await pool.query(sql);
  schemaApplied = true;
}

/** Retry the connection every 2 seconds until Postgres answers. */
export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export interface PracticeRow {
  id: string;
  clock_now: Date | null;
  reminder_hour: number;
}

export async function getPractice(practiceId: string): Promise<PracticeRow | null> {
  const result = await pool.query(
    'select id, clock_now, reminder_hour from practices where id = $1',
    [practiceId],
  );
  return result.rows[0] ?? null;
}

export interface UserRow {
  id: string;
  practice_id: string;
  role: 'bookkeeper' | 'owner';
  display_name: string;
  email: string;
  password_hash: string;
  client_id: string | null;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const result = await pool.query('select * from users where email = $1', [email]);
  return result.rows[0] ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const result = await pool.query('select * from users where id = $1', [id]);
  return result.rows[0] ?? null;
}

export interface SessionRow {
  token: string;
  user_id: string;
  expires_at: Date;
}

export async function createSession(token: string, userId: string, ttlSeconds: number): Promise<void> {
  await pool.query(
    'insert into sessions (token, user_id, created_at, expires_at) values ($1, $2, now(), now() + make_interval(secs => $3))',
    [token, userId, ttlSeconds],
  );
}

export async function getSession(token: string): Promise<{ user: UserRow; expires_at: Date } | null> {
  const result = await pool.query(
    `select u.*, s.expires_at from sessions s
     join users u on u.id = s.user_id
     where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return { user: row, expires_at: row.expires_at };
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query('delete from sessions where token = $1', [token]);
}

export interface StateRow {
  practice_id: string;
  code: string;
  name: string;
  zone: string;
  holidays: string[];
}

export async function getStates(practiceId: string): Promise<StateRow[]> {
  const result = await pool.query(
    'select practice_id, code, name, zone, holidays from states where practice_id = $1 order by code',
    [practiceId],
  );
  return result.rows.map(rowToState);
}

function rowToState(row: pg.QueryResultRow): StateRow {
  return {
    practice_id: row.practice_id,
    code: row.code,
    name: row.name,
    zone: row.zone,
    holidays: row.holidays.map((d: Date) => isoDate(d)),
  };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface EditionRecord {
  state_code: string;
  effective_date: string;
  due_day: number;
  carry: 'next_business' | 'fixed';
  rate: string;
  extension_days: number;
}

export async function getEditions(practiceId: string): Promise<EditionRecord[]> {
  const result = await pool.query(
    'select state_code, effective_date, due_day, carry, rate, extension_days from editions where practice_id = $1 order by state_code, effective_date',
    [practiceId],
  );
  return result.rows.map((row) => ({
    state_code: row.state_code,
    effective_date: isoDate(row.effective_date),
    due_day: row.due_day,
    carry: row.carry,
    rate: row.rate,
    extension_days: row.extension_days,
  }));
}
