import { DateTime } from 'luxon';
import { query } from './database';
import { hashPassword } from '../domain/ids';
import { torontoTz } from '../time';

export interface AccountRow {
  id: number;
  number: string | null;
  email: string;
  password_hash: string;
  name: string;
  locale: string;
  role: string;
}

export interface SeasonRow {
  slug: string;
  title_en: string;
  title_fr: string;
  public_sale_date: string;
  state: string;
}

export interface ScreeningRow {
  id: string;
  season_slug: string;
  film_title: string;
  format: string;
  auditorium: string;
  starts_at: string;
  starts_local: string;
  ordinal: number;
  notes: string;
}

/** The one hold-liveness rule: live while server time is strictly before expires_at. */
export function holdLive(state: string, expiresAt: string, now: DateTime): boolean {
  return state === 'held' && DateTime.fromISO(expiresAt) > now;
}

export async function findAccountByEmail(email: string): Promise<AccountRow | null> {
  const res = await query<AccountRow>(
    'SELECT id, number, email, password_hash, name, locale, role FROM accounts WHERE lower(email) = lower($1)',
    [email],
  );
  return res.rows[0] ?? null;
}

export async function findAccountById(id: number): Promise<AccountRow | null> {
  const res = await query<AccountRow>(
    'SELECT id, number, email, password_hash, name, locale, role FROM accounts WHERE id = $1',
    [id],
  );
  return res.rows[0] ?? null;
}

export async function nextAccountNumber(): Promise<string> {
  const res = await query<{ max: string | null }>(
    "SELECT max(substring(number from 3)::integer)::text AS max FROM accounts WHERE number LIKE 'A-%'",
  );
  const max = Number(res.rows[0].max ?? 100000);
  return `A-${max + 1}`;
}

export async function createPatronAccount(input: {
  email: string; name: string; password: string; locale: string;
}): Promise<AccountRow> {
  const number = await nextAccountNumber();
  const res = await query<AccountRow>(
    `INSERT INTO accounts (number, email, password_hash, name, locale, role)
     VALUES ($1,$2,$3,$4,$5,'patron') RETURNING id, number, email, password_hash, name, locale, role`,
    [number, input.email, hashPassword(input.password), input.name, input.locale],
  );
  return res.rows[0];
}

export async function createSession(accountId: number | null): Promise<string> {
  const token = hashPassword(`session:${Date.now()}:${Math.random()}`).slice(0, 43);
  await query('INSERT INTO sessions (token, account_id, guest) VALUES ($1,$2,$3)', [token, accountId, accountId === null]);
  return token;
}

export async function accountFromSession(token: string): Promise<AccountRow | null> {
  const res = await query<AccountRow>(
    `SELECT a.id, a.number, a.email, a.password_hash, a.name, a.locale, a.role
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token = $1`,
    [token],
  );
  return res.rows[0] ?? null;
}

export async function seasonBySlug(slug: string): Promise<SeasonRow | null> {
  const res = await query<SeasonRow>(
    'SELECT slug, title_en, title_fr, public_sale_date::text AS public_sale_date, state FROM seasons WHERE slug = $1',
    [slug],
  );
  return res.rows[0] ?? null;
}

export async function screeningById(id: string): Promise<ScreeningRow | null> {
  const res = await query<ScreeningRow>(
    `SELECT id, season_slug, film_title, format, auditorium, starts_at::text AS starts_at,
            starts_local, ordinal, notes
     FROM screenings WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function seasonScreenings(slug: string): Promise<ScreeningRow[]> {
  const res = await query<ScreeningRow>(
    `SELECT id, season_slug, film_title, format, auditorium, starts_at::text AS starts_at,
            starts_local, ordinal, notes
     FROM screenings WHERE season_slug = $1 ORDER BY starts_at, ordinal`,
    [slug],
  );
  return res.rows;
}

export async function allSeasons(): Promise<SeasonRow[]> {
  const res = await query<SeasonRow>(
    'SELECT slug, title_en, title_fr, public_sale_date::text AS public_sale_date, state FROM seasons',
  );
  return res.rows;
}

export function todayToronto(): DateTime {
  return DateTime.now().setZone(torontoTz).startOf('day');
}
