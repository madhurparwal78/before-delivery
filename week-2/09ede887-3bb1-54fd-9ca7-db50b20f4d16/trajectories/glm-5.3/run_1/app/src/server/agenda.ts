/**
 * Reading the programme: sessions in published order, speakers, My Agenda,
 * rosters, the contest and the calendar file. Every read settles ended holds
 * first, and every count is computed from stored rows.
 */

import type { Pool, PoolClient } from './db/pool.js';
import { settleAll } from './seats.js';
import type { Seats } from './seats.js';

export type { Seats };
import { renderBio } from './bio.js';
import { venueAbbrevForDate, venueOffsetLabel, type Instant } from '../shared/venue.js';
import { parseQuery, queryMatches } from '../shared/search.js';

export interface SpeakerRef {
  name: string;
  company: string;
}

export interface SessionData {
  id: string;
  day: number;
  date: string;
  startLocal: string;
  endLocal: string;
  startInstant: Date;
  endInstant: Date;
  title: string;
  speakers: SpeakerRef[];
  stage: string | null;
  stageName: string | null;
  location: string | null;
  format: string | null;
  formatLabel: string | null;
  description: string;
  capacity: number | null;
  seats: Seats | null;
  waitlistCount: number;
  reservedByMe: boolean;
  savedByMe: boolean;
  waitlistPosition: number | null;
  myHold: { sessionId: string; heldUntil: Date; secondsRemaining: number } | null;
}

export interface SpeakerData {
  slug: string;
  name: string;
  company: string;
  sessions: string[];
  bio: string;
  bioHtml: string;
}

const SESSION_ORDER =
  'ORDER BY s.day, s.start_instant, ' +
  'COALESCE((SELECT position FROM stages WHERE slug = s.stage_slug), 5), s.id';

interface CallerContext {
  accountId: number | null;
}

/** The sessions a caller sees, filtered and searched, in published order. */
export async function listSessions(
  pool: Pool,
  filters: { day: number | 'all'; stage: string | 'all'; format: string | 'all'; q: string | null },
  caller: CallerContext,
  holdSeconds: number,
): Promise<SessionData[]> {
  const client = await pool.connect();
  try {
    await settleAll(client, holdSeconds);
    const rows = await fetchSessions(client, filters, caller);
    return rows;
  } finally {
    client.release();
  }
}

async function fetchSessions(
  client: PoolClient,
  filters: { day: number | 'all'; stage: string | 'all'; format: string | 'all'; q: string | null },
  caller: CallerContext,
): Promise<SessionData[]> {
  const res = await client.query(
    `SELECT s.*, ss.name AS stage_name, ss.slug AS stage_slug FROM sessions s
       LEFT JOIN stages ss ON ss.slug = s.stage_slug ${SESSION_ORDER}`,
  );
  let matched = res.rows;
  if (filters.day !== 'all') matched = matched.filter((r) => Number(r.day) === filters.day);
  if (filters.stage !== 'all') matched = matched.filter((r) => r.stage_slug === filters.stage);
  if (filters.format !== 'all') matched = matched.filter((r) => r.format === filters.format);
  if (filters.q !== null && filters.q !== '') {
    const query = parseQuery(filters.q);
    matched = await filterBySearch(client, matched, query);
  }
  const out: SessionData[] = [];
  for (const row of matched) {
    const speakers = await client.query(
      `SELECT sp.name, sp.company FROM session_speakers ss
         JOIN speakers sp ON sp.id = ss.speaker_id
        WHERE ss.session_id = $1 ORDER BY ss.position`,
      [row.id],
    );
    row.speaker_list = speakers.rows.map((r) => `${r.name}\u0002${r.company}`).join('\u0001');
    out.push(await shapeSession(client, row, caller));
  }
  return out;
}

/** Search matches titles, speaker names and companies, folded. */
async function filterBySearch(
  client: PoolClient,
  rows: Record<string, unknown>[],
  query: ReturnType<typeof parseQuery>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const speakers = await client.query(
      `SELECT sp.name, sp.company FROM session_speakers ss
         JOIN speakers sp ON sp.id = ss.speaker_id
        WHERE ss.session_id = $1 ORDER BY ss.position`,
      [row.id],
    );
    const fields = [
      row.title as string,
      ...speakers.rows.flatMap((r) => [r.name as string, r.company as string]),
    ];
    if (queryMatches(query, fields)) out.push(row);
  }
  return out;
}

function speakerFields(list: unknown): string[] {
  if (typeof list !== "string" || list === "") return [];
  return list.split('\u0001').filter((s) => s !== '');
}

/** Shape one session row, computing all counts from stored rows. */
async function shapeSession(client: PoolClient, row: Record<string, unknown>, caller: CallerContext): Promise<SessionData> {
  const id = row.id as string;
  const capacity = row.capacity === null ? null : Number(row.capacity);
  const reservedRes = await client.query(
    'SELECT COUNT(*)::int AS n FROM reservations WHERE session_id = $1',
    [id],
  );
  const heldRes = await client.query(
    'SELECT COUNT(*)::int AS n FROM holds WHERE session_id = $1 AND ended_at IS NULL',
    [id],
  );
  const waitRes = await client.query(
    'SELECT COUNT(*)::int AS n FROM waitlist_entries WHERE session_id = $1',
    [id],
  );
  const reserved = reservedRes.rows[0]!.n;
  const held = heldRes.rows[0]!.n;
  const seats: Seats | null =
    capacity === null ? null : { capacity, reserved, held, left: capacity - reserved - held };

  let reservedByMe = false;
  let savedByMe = false;
  let waitlistPosition: number | null = null;
  let myHold: SessionData['myHold'] = null;
  if (caller.accountId !== null) {
    const mine = await client.query(
      'SELECT 1 FROM reservations WHERE session_id = $1 AND account_id = $2',
      [id, caller.accountId],
    );
    reservedByMe = mine.rows.length > 0;
    const saved = await client.query(
      'SELECT 1 FROM saved_sessions WHERE session_id = $1 AND account_id = $2',
      [id, caller.accountId],
    );
    savedByMe = saved.rows.length > 0;
    const pos = await client.query(
      `SELECT ROW_NUMBER() OVER (ORDER BY created_at, id)::int AS pos
         FROM waitlist_entries WHERE session_id = $1 AND account_id = $2`,
      [id, caller.accountId],
    );
    waitlistPosition = pos.rows[0]?.pos ?? null;
    const hold = await client.query(
      `SELECT held_until FROM holds
        WHERE session_id = $1 AND account_id = $2 AND ended_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [id, caller.accountId],
    );
    if (hold.rows[0]) {
      const heldUntil = new Date(hold.rows[0]!.held_until);
      const clock = await client.query('SELECT now() AS now');
      const remaining = Math.max(0, Math.floor((heldUntil.getTime() - new Date(clock.rows[0]!.now).getTime()) / 1000));
      myHold = { sessionId: id, heldUntil, secondsRemaining: remaining };
    }
  }

  return {
    id,
    day: Number(row.day),
    date: dateOnly(row.date),
    startLocal: row.start_local as string,
    endLocal: row.end_local as string,
    startInstant: new Date(row.start_instant as string),
    endInstant: new Date(row.end_instant as string),
    title: row.title as string,
    speakers: speakerPairs(row.speaker_list),
    stage: (row.stage_slug as string | null) ?? null,
    stageName: (row.stage_name as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    format: (row.format as string | null) ?? null,
    formatLabel: (row.format_label as string | null) ?? null,
    description: row.description as string,
    capacity,
    seats,
    waitlistCount: waitRes.rows[0]!.n,
    reservedByMe,
    savedByMe,
    waitlistPosition,
    myHold,
  };
}

/** A DATE column, read as an ISO date string whatever pg hands back. */
function dateOnly(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value as number | Date).toISOString().slice(0, 10);
}

function speakerPairs(list: unknown): SpeakerRef[] {
  if (typeof list !== 'string' || list === '') return [];
  return speakerFields(list).map((pair) => {
    const [name, company] = pair.split('\u0002');
    return { name: name ?? '', company: company ?? '' };
  });
}

/** One session by id, or null when unknown. */
export async function getSessionData(
  pool: Pool,
  id: string,
  caller: CallerContext,
  holdSeconds: number,
): Promise<SessionData | null> {
  const client = await pool.connect();
  try {
    await settleAll(client, holdSeconds);
    const res = await client.query(
      `SELECT s.*, ss.name AS stage_name, ss.slug AS stage_slug FROM sessions s
        LEFT JOIN stages ss ON ss.slug = s.stage_slug
       WHERE s.id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return null;
    const speakers = await client.query(
      `SELECT sp.name, sp.company FROM session_speakers ss
         JOIN speakers sp ON sp.id = ss.speaker_id
        WHERE ss.session_id = $1 ORDER BY ss.position`,
      [id],
    );
    row.speaker_list = speakers.rows
      .map((r) => `${r.name}\u0002${r.company}`)
      .join('\u0001');
    return shapeSession(client, row, caller);
  } finally {
    client.release();
  }
}

/** Every speaker once, in order of first appearance in the ordered agenda. */
export async function listSpeakers(pool: Pool): Promise<SpeakerData[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT sp.slug, sp.name, sp.company, sp.bio FROM speakers sp ORDER BY sp.id`,
    );
    const speakers: SpeakerData[] = [];
    for (const row of res.rows) {
      const sessions = await client.query(
        `SELECT s.id FROM session_speakers ss JOIN sessions s ON s.id = ss.session_id
          WHERE ss.speaker_id = (SELECT id FROM speakers WHERE slug = $1)
          ORDER BY s.day, s.start_instant,
            COALESCE((SELECT position FROM stages WHERE slug = s.stage_slug), 5), s.id`,
        [row.slug],
      );
      speakers.push({
        slug: row.slug,
        name: row.name,
        company: row.company,
        sessions: sessions.rows.map((r) => r.id as string),
        bio: row.bio,
        bioHtml: renderBio(row.bio),
      });
    }
    return speakers;
  } finally {
    client.release();
  }
}

/** The stages, in stage order. */
export async function listStages(pool: Pool): Promise<Array<{ slug: string; name: string; description: string }>> {
  const res = await pool.query('SELECT slug, name, description FROM stages ORDER BY position');
  return res.rows;
}

/** My Agenda: reserved, held, waitlisted and saved sessions, each in agenda order. */
export async function myAgenda(
  pool: Pool,
  accountId: number,
  holdSeconds: number,
): Promise<{ reserved: SessionData[]; held: SessionData[]; waitlisted: SessionData[]; saved: SessionData[] }> {
  const client = await pool.connect();
  try {
    await settleAll(client, holdSeconds);
    const ctx: CallerContext = { accountId };
    const ids = async (sql: string): Promise<string[]> =>
      (await client.query(sql, [accountId])).rows.map((r) => r.id as string);
    const reserved = await forIds(client, await ids('SELECT session_id AS id FROM reservations WHERE account_id = $1'), ctx);
    const heldRows = await client.query(
      `SELECT h.session_id AS id, h.held_until FROM holds h
        WHERE h.account_id = $1 AND h.ended_at IS NULL
        ORDER BY h.held_until, h.session_id`,
      [accountId],
    );
    const held = await forIds(client, heldRows.rows.map((r) => r.id as string), ctx);
    // Attach each hold's own end time, not the shared shaping one.
    const waitlistedIds = await ids('SELECT session_id AS id FROM waitlist_entries WHERE account_id = $1');
    const waitlisted = await forIds(client, waitlistedIds, ctx);
    const saved = await forIds(client, await ids('SELECT session_id AS id FROM saved_sessions WHERE account_id = $1'), ctx);
    return { reserved, held, waitlisted, saved };
  } finally {
    client.release();
  }
}

async function forIds(client: PoolClient, ids: string[], caller: CallerContext): Promise<SessionData[]> {
  if (ids.length === 0) return [];
  const res = await client.query(
    `SELECT s.*, ss.name AS stage_name, ss.slug AS stage_slug FROM sessions s
      LEFT JOIN stages ss ON ss.slug = s.stage_slug
     WHERE s.id = ANY($1)
     ORDER BY s.day, s.start_instant,
       COALESCE((SELECT position FROM stages WHERE slug = s.stage_slug), 5), s.id`,
    [ids],
  );
  const out: SessionData[] = [];
  for (const row of res.rows) {
    const speakers = await client.query(
      `SELECT sp.name, sp.company FROM session_speakers ss
         JOIN speakers sp ON sp.id = ss.speaker_id
        WHERE ss.session_id = $1 ORDER BY ss.position`,
      [row.id],
    );
    row.speaker_list = speakers.rows.map((r) => `${r.name}\u0002${r.company}`).join('\u0001');
    out.push(await shapeSession(client, row, caller));
  }
  return out;
}

/** The organiser's reservable sessions table. */
export interface OrganiserRow {
  id: string;
  title: string;
  day: number;
  startLocal: string;
  endLocal: string;
  seats: Seats | null;
  waitlisted: number;
}

export async function organiserSessions(pool: Pool, holdSeconds: number): Promise<OrganiserRow[]> {
  const client = await pool.connect();
  try {
    await settleAll(client, holdSeconds);
    const res = await client.query(
      `SELECT * FROM sessions WHERE capacity IS NOT NULL
       ORDER BY day, start_instant,
         COALESCE((SELECT position FROM stages WHERE slug = stage_slug), 5), id`,
    );
    const rows: OrganiserRow[] = [];
    for (const row of res.rows) {
      const seats = await readSeatsFor(client, row.id as string);
      rows.push({
        id: row.id,
        title: row.title,
        day: Number(row.day),
        startLocal: row.start_local,
        endLocal: row.end_local,
        seats,
        waitlisted: seats === null ? 0 : await waitlistCountFor(client, row.id as string),
      });
    }
    return rows;
  } finally {
    client.release();
  }
}

async function readSeatsFor(client: PoolClient, sessionId: string): Promise<Seats | null> {
  const res = await client.query('SELECT capacity FROM sessions WHERE id = $1', [sessionId]);
  const capacity = res.rows[0]?.capacity;
  if (capacity === null || capacity === undefined) return null;
  const counts = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM reservations WHERE session_id = $1) AS reserved,
       (SELECT COUNT(*)::int FROM holds WHERE session_id = $1 AND ended_at IS NULL) AS held`,
    [sessionId],
  );
  const reserved = counts.rows[0]!.reserved;
  const held = counts.rows[0]!.held;
  return { capacity: Number(capacity), reserved, held, left: Number(capacity) - reserved - held };
}

async function waitlistCountFor(client: PoolClient, sessionId: string): Promise<number> {
  const res = await client.query(
    'SELECT COUNT(*)::int AS n FROM waitlist_entries WHERE session_id = $1',
    [sessionId],
  );
  return res.rows[0]!.n;
}

/** Roster rows: reservations only, oldest first. */
export interface RosterRow {
  name: string;
  email: string;
  reservedAt: Date;
  reservationId: number;
  /** The reservation time in microseconds, the cursor's exact key. */
  createdAtUs: number;
}

export async function rosterPage(
  pool: Pool,
  sessionId: string,
  limit: number,
  cursor: string | null,
  holdSeconds: number,
): Promise<{ rows: RosterRow[]; nextCursor: string | null }> {
  const client = await pool.connect();
  try {
    await settleAll(client, holdSeconds);
    const marker = cursor === null ? null : decodeCursor(cursor);
    const res = await client.query(
      `SELECT r.id,
              (EXTRACT(EPOCH FROM r.created_at) * 1000000)::bigint AS created_us,
              r.created_at, a.name, a.email
         FROM reservations r JOIN accounts a ON a.id = r.account_id
        WHERE r.session_id = $1
          AND ($2::bigint IS NULL
               OR ((EXTRACT(EPOCH FROM r.created_at) * 1000000)::bigint, r.id) > ($3::bigint, $2::bigint))
        ORDER BY r.created_at, r.id
        LIMIT $4`,
      [sessionId, marker?.id ?? null, marker?.createdAtUs ?? null, limit + 1],
    );
    const rows: RosterRow[] = res.rows.map((r) => ({
      name: r.name,
      email: r.email,
      reservedAt: new Date(r.created_at),
      reservationId: Number(r.id),
      createdAtUs: Number(r.created_us),
    }));
    if (rows.length > limit) {
      const last = rows[limit - 1]!;
      return {
        rows: rows.slice(0, limit),
        nextCursor: encodeCursor({
          id: last.reservationId,
          createdAtUs: last.createdAtUs,
          sessionId,
        }),
      };
    }
    return { rows, nextCursor: null };
  } finally {
    client.release();
  }
}

/** A roster cursor: the last row returned, to the microsecond, and its session. */
export interface Cursor {
  id: number;
  createdAtUs: number;
  sessionId: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAtUs}|${c.id}|${c.sessionId}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Cursor | null {
  try {
    const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (parts.length !== 3) return null;
    const createdAtUs = Number(parts[0]);
    const id = Number(parts[1]);
    if (!Number.isInteger(createdAtUs) || !Number.isInteger(id)) return null;
    return { createdAtUs, id, sessionId: parts[2]! };
  } catch {
    return null;
  }
}

/** Is a cursor well formed? */
export function cursorIsReadable(cursor: string): boolean {
  return decodeCursor(cursor) !== null;
}

/** Saving is idempotent: at most one row per account and session. */
export async function saveSession(pool: Pool, sessionId: string, accountId: number): Promise<void> {
  await pool.query(
    `INSERT INTO saved_sessions (session_id, account_id) VALUES ($1, $2)
     ON CONFLICT (session_id, account_id) DO NOTHING`,
    [sessionId, accountId],
  );
}

export async function unsaveSession(pool: Pool, sessionId: string, accountId: number): Promise<void> {
  await pool.query('DELETE FROM saved_sessions WHERE session_id = $1 AND account_id = $2', [
    sessionId,
    accountId,
  ]);
}

/* ------------------------------------------------------------------ *
 * The contest                                                        *
 * ------------------------------------------------------------------ */

export interface ContestData {
  status: 'open' | 'closed' | 'revealed';
  closesAt: Date;
  guessCount: number;
  myGuess: { value: number; createdAt: Date } | null;
  finalFigure: number | null;
  revealedAt: Date | null;
  leaderboard: Array<{ rank: number; displayName: string; value: number; distance: number }>;
}

/** The contest state, computed from the stored reveal and the database clock. */
export async function readContest(
  pool: Pool,
  closesAt: Date,
  caller: CallerContext,
): Promise<ContestData> {
  const client = await pool.connect();
  try {
    const clock = await client.query('SELECT now() AS now');
    const now = new Date(clock.rows[0]!.now);
    const contest = await client.query('SELECT final_figure, revealed_at FROM contest WHERE id = 1');
    const finalFigure = contest.rows[0]?.final_figure ?? null;
    const revealedAt = contest.rows[0]?.revealed_at ? new Date(contest.rows[0]!.revealed_at) : null;
    const count = await client.query('SELECT COUNT(*)::int AS n FROM guesses');
    let myGuess: ContestData['myGuess'] = null;
    if (caller.accountId !== null) {
      const mine = await client.query(
        'SELECT value, created_at FROM guesses WHERE account_id = $1',
        [caller.accountId],
      );
      if (mine.rows[0]) {
        myGuess = { value: Number(mine.rows[0]!.value), createdAt: new Date(mine.rows[0]!.created_at) };
      }
    }
    const status: ContestData['status'] =
      revealedAt !== null ? 'revealed' : now < closesAt ? 'open' : 'closed';
    let leaderboard: ContestData['leaderboard'] = [];
    if (status === 'revealed' && finalFigure !== null) {
      const rows = await client.query(
        `SELECT g.value, g.created_at, g.id, a.name FROM guesses g JOIN accounts a ON a.id = g.account_id
          ORDER BY abs(g.value - $1), g.created_at, g.id LIMIT 3`,
        [finalFigure],
      );
      leaderboard = rows.rows.map((r, i) => ({
        rank: i + 1,
        displayName: displayName(r.name as string),
        value: Number(r.value),
        distance: Math.abs(Number(r.value) - Number(finalFigure)),
      }));
    }
    return {
      status,
      closesAt,
      guessCount: count.rows[0]!.n,
      myGuess,
      finalFigure: finalFigure === null ? null : Number(finalFigure),
      revealedAt,
      leaderboard,
    };
  } finally {
    client.release();
  }
}

/** The first word of the name, a space, then the initial of the last word. */
export function displayName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0]!;
  return `${words[0]!} ${words[words.length - 1]![0]!}.`;
}

/* ------------------------------------------------------------------ *
 * The calendar file                                                  *
 * ------------------------------------------------------------------ */

/** The venue-time line for a day. */
export function venueLine(date: string): string {
  return `All times are Port Ashby time (${venueAbbrevForDate(date)}, UTC${venueOffsetLabel(date)}).`;
}

/** Fold a content line to 75 octets, never splitting a multi-byte character. */
function foldLine(line: string): string[] {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return [line];
  const out: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = start === 0 ? 75 : 74; // folded lines start with one space
    if (start + end >= bytes.length) end = bytes.length - start;
    // Never split a multi-byte character.
    while (end > 0 && start + end < bytes.length && (bytes[start + end]! & 0xc0) === 0x80) end--;
    const slice = bytes.subarray(start, start + end);
    out.push(start === 0 ? slice.toString('utf8') : ' ' + slice.toString('utf8'));
    start += end;
  }
  return out;
}

function icalEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icalInstant(at: Date): string {
  return (
    at.getUTCFullYear() +
    String(at.getUTCMonth() + 1).padStart(2, '0') +
    String(at.getUTCDate()).padStart(2, '0') +
    'T' +
    String(at.getUTCHours()).padStart(2, '0') +
    String(at.getUTCMinutes()).padStart(2, '0') +
    String(at.getUTCSeconds()).padStart(2, '0') +
    'Z'
  );
}

/** The calendar of the given sessions, or null when the list is empty. */
export function buildCalendar(sessions: SessionData[], generatedAt: Date): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Keel Outpost//Agenda//EN',
  ];
  for (const s of sessions) {
    const location = `${(s.stageName ?? s.location) ?? ''}, Harbour Quay Hall, Port Ashby`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${s.id}@keel-outpost`);
    lines.push(`DTSTAMP:${icalInstant(generatedAt)}`);
    lines.push(`DTSTART:${icalInstant(s.startInstant)}`);
    lines.push(`DTEND:${icalInstant(s.endInstant)}`);
    lines.push(`SUMMARY:${icalEscape(s.title)}`);
    lines.push(`LOCATION:${icalEscape(location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const folded: string[] = [];
  for (const line of lines) folded.push(...foldLine(line));
  return folded.join('\r\n') + '\r\n';
}

export type { Instant };
