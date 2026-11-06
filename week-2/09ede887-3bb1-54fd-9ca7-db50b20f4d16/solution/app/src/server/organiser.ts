import { AGENDA_ORDER } from './agenda';
import type { SeatCounts } from './booking';
import { csvText } from './csv';
import type { Db } from './db';
import { invalidFields } from './errors';

export interface OrganiserRecord extends SeatCounts {
  id: string;
  title: string;
  day: number;
  start_local: string;
  end_local: string;
  waitlisted: number;
}

// Every session that has a capacity, with its counts from stored rows, in agenda order.
export async function organiserRows(db: Db, sessionId: string | null = null): Promise<OrganiserRecord[]> {
  const result = await db.query<OrganiserRecord>(
    `SELECT s.id, s.title, s.day, s.start_local, s.end_local,
            ss.capacity, ss.reserved, ss.held, ss.seats_left, ss.waitlisted
       FROM sessions s JOIN session_seats ss ON ss.session_id = s.id
      WHERE s.capacity IS NOT NULL AND ($1::text IS NULL OR s.id = $1)
      ORDER BY ${AGENDA_ORDER}`,
    [sessionId],
  );
  return result.rows;
}

const CAPACITY_COPY = 'Enter a whole number from 1 to 500.';

export function capacityFrom(body: unknown): number {
  const capacity = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).capacity : undefined;
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    throw invalidFields({ capacity: CAPACITY_COPY });
  }
  return capacity;
}

export interface RosterRecord {
  name: string;
  email: string;
  reserved_at: string;
}

interface Cursor {
  createdAt: string;
  id: number;
}

const LIMIT_COPY = 'Enter a whole number from 1 to 100.';
const CURSOR_COPY = 'Start again from the first page.';
const DEFAULT_LIMIT = 50;

function encodeCursor(sessionId: string, cursor: Cursor): string {
  return Buffer.from(JSON.stringify([sessionId, cursor.createdAt, cursor.id])).toString('base64url');
}

function decodeCursor(sessionId: string, raw: string): Cursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [owner, createdAt, id] = value as unknown[];
    if (owner !== sessionId || typeof createdAt !== 'string' || !Number.isInteger(id)) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id: id as number };
  } catch {
    return null;
  }
}

interface RosterRequest {
  limit: number;
  after: Cursor | null;
}

// Roster paging parameters: limit 1 to 100 (50 by default) and an opaque cursor for this session.
export function rosterRequest(sessionId: string, params: URLSearchParams): RosterRequest {
  const rawLimit = params.get('limit');
  const rawCursor = params.get('cursor');
  const digits = rawLimit !== null && rawLimit !== '' && Array.from(rawLimit).every((c) => c >= '0' && c <= '9');
  const limit = rawLimit === null ? DEFAULT_LIMIT : digits ? Number(rawLimit) : 0;
  const after = rawCursor === null ? null : decodeCursor(sessionId, rawCursor);
  const fields: Record<string, string> = {};
  if (limit < 1 || limit > 100) fields.limit = LIMIT_COPY;
  if (rawCursor !== null && after === null) fields.cursor = CURSOR_COPY;
  if (Object.keys(fields).length > 0) throw invalidFields(fields);
  return { limit, after };
}

interface RosterRow extends RosterRecord {
  id: number;
  created_key: string;
}

// Rosters list reservations oldest first. Pages are cut after the last row returned, never by
// an offset, so changes between pages never repeat or skip a row that existed throughout.
async function rosterRows(db: Db, sessionId: string, after: Cursor | null, limit: number | null): Promise<RosterRow[]> {
  const result = await db.query<RosterRow>(
    `SELECT a.name, a.email, iso(r.created_at) AS reserved_at, r.id,
            to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_key
       FROM reservations r JOIN accounts a ON a.id = r.account_id
      WHERE r.session_id = $1 AND ($2::timestamptz IS NULL OR (r.created_at, r.id) > ($2::timestamptz, $3::bigint))
      ORDER BY r.created_at, r.id
      LIMIT $4`,
    [sessionId, after?.createdAt ?? null, after?.id ?? null, limit],
  );
  return result.rows;
}

export async function rosterPage(
  db: Db,
  sessionId: string,
  request: RosterRequest,
): Promise<{ rows: RosterRecord[]; nextCursor: string | null }> {
  const rows = await rosterRows(db, sessionId, request.after, request.limit + 1);
  const page = rows.slice(0, request.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > request.limit && last !== undefined
      ? encodeCursor(sessionId, { createdAt: last.created_key, id: last.id })
      : null;
  return { rows: page.map((row) => ({ name: row.name, email: row.email, reserved_at: row.reserved_at })), nextCursor };
}

export async function rosterCsv(db: Db, sessionId: string): Promise<string> {
  const rows = await rosterRows(db, sessionId, null, null);
  return csvText([['name', 'email', 'reserved_at'], ...rows.map((row) => [row.name, row.email, row.reserved_at])]);
}

const BIO_COPY = 'Use at most 2,000 characters.';

export function bioFrom(body: unknown): string {
  const bio = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).bio : undefined;
  if (typeof bio !== 'string' || Array.from(bio).length > 2000) throw invalidFields({ bio: BIO_COPY });
  return bio;
}

export async function saveBio(db: Db, slug: string, bio: string): Promise<void> {
  await db.query('UPDATE speakers SET bio = $2 WHERE slug = $1', [slug, bio]);
}
