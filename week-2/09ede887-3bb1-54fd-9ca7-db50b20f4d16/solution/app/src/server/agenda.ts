import type { Db } from './db';
import { ApiError, invalidFields } from './errors';
import { fold, matches, parseQuery } from './search';

// The published agenda order: day, venue start, stage order (no stage last), then id.
export const AGENDA_ORDER =
  's.day, s.start_local, (SELECT position FROM stages WHERE slug = s.stage) NULLS LAST, s.id';

const FORMAT_LABELS: Record<string, string> = {
  'demo-qa': 'Demo + Q&A',
  fireside: 'Fireside',
  game: 'Game',
  keynote: 'Keynote',
  panel: 'Panel',
  workshop: 'Workshop',
};

const SEARCH_MAX = 2048;
const SEARCH_COPY = 'Use at most 2,048 characters.';

export interface SessionRecord {
  id: string;
  day: number;
  date: string;
  start_local: string;
  end_local: string;
  start_instant: string;
  end_instant: string;
  title: string;
  speakers: { name: string; company: string }[];
  stage: string | null;
  stage_name: string | null;
  location: string | null;
  format: string | null;
  description: string;
  capacity: number | null;
  reserved: number;
  held: number;
  seats_left: number;
  waitlisted: number;
  reserved_by_me: boolean;
  saved_by_me: boolean;
  waitlist_position: number | null;
  hold_until: string | null;
  hold_seconds: number | null;
}

export function formatLabel(format: string | null): string | null {
  return format === null ? null : (FORMAT_LABELS[format] ?? null);
}

// One statement reads sessions with their seats (session_seats) and the caller's own state.
const SESSION_SELECT = `
  SELECT s.id, s.day, to_char(s.date, 'YYYY-MM-DD') AS date, s.start_local, s.end_local,
         iso(s.start_instant) AS start_instant, iso(s.end_instant) AS end_instant, s.title,
         (SELECT coalesce(json_agg(json_build_object('name', sp.name, 'company', sp.company) ORDER BY x.position), '[]')
            FROM session_speakers x JOIN speakers sp ON sp.slug = x.speaker_slug WHERE x.session_id = s.id) AS speakers,
         s.stage, (SELECT name FROM stages WHERE slug = s.stage) AS stage_name, s.location, s.format, s.description,
         s.capacity, ss.reserved, ss.held, ss.seats_left, ss.waitlisted,
         EXISTS (SELECT 1 FROM reservations WHERE session_id = s.id AND account_id = $1) AS reserved_by_me,
         EXISTS (SELECT 1 FROM saved_sessions WHERE session_id = s.id AND account_id = $1) AS saved_by_me,
         (SELECT q.position FROM (SELECT account_id, row_number() OVER (ORDER BY created_at, id)::int AS position
                                    FROM waitlist_entries WHERE session_id = s.id) q
           WHERE q.account_id = $1) AS waitlist_position,
         h.hold_until, h.hold_seconds
  FROM sessions s
  JOIN session_seats ss ON ss.session_id = s.id
  LEFT JOIN LATERAL (
    SELECT iso(held_until) AS hold_until,
           GREATEST(0, floor(extract(epoch FROM held_until - clock_timestamp())))::int AS hold_seconds
    FROM live_holds WHERE session_id = s.id AND account_id = $1
  ) h ON true`;

export async function sessionsWhere(db: Db, callerId: string | null, where: string, values: unknown[]): Promise<SessionRecord[]> {
  const result = await db.query<SessionRecord>(`${SESSION_SELECT} WHERE ${where} ORDER BY ${AGENDA_ORDER}`, [
    callerId,
    ...values,
  ]);
  return result.rows;
}

export async function readSession(db: Db, callerId: string | null, id: string): Promise<SessionRecord | null> {
  const [row] = await sessionsWhere(db, callerId, 's.id = $2', [id]);
  return row ?? null;
}

export async function sessionExists(db: Db, id: string): Promise<boolean> {
  const result = await db.query('SELECT 1 FROM sessions WHERE id = $1', [id]);
  return result.rowCount === 1;
}

interface AgendaFilter {
  day: number | null;
  stage: string | null;
  format: string | null;
  query: string;
}

// Reads and checks day, stage, format and (v2 only) q from a query string.
export async function agendaFilter(db: Db, params: URLSearchParams, withSearch: boolean): Promise<AgendaFilter> {
  const day = params.get('day');
  const stage = params.get('stage');
  const format = params.get('format');
  const stages = await db.query<{ slug: string }>('SELECT slug FROM stages');
  const stageSlugs = new Set(stages.rows.map((row) => row.slug));
  const known = (value: string | null, allowed: (v: string) => boolean): boolean =>
    value === null || value === 'all' || allowed(value);
  if (!known(day, (v) => v === '1' || v === '2') || !known(stage, (v) => stageSlugs.has(v)) || !known(format, (v) => v in FORMAT_LABELS)) {
    throw new ApiError('invalid_filter');
  }
  const query = withSearch ? (params.get('q') ?? '') : '';
  if (Array.from(query).length > SEARCH_MAX) throw invalidFields({ q: SEARCH_COPY });
  return {
    day: day === null || day === 'all' ? null : Number(day),
    stage: stage === null || stage === 'all' ? null : stage,
    format: format === null || format === 'all' ? null : format,
    query,
  };
}

export async function listSessions(db: Db, callerId: string | null, filter: AgendaFilter): Promise<SessionRecord[]> {
  const rows = await sessionsWhere(
    db,
    callerId,
    '($2::int IS NULL OR s.day = $2) AND ($3::text IS NULL OR s.stage = $3) AND ($4::text IS NULL OR s.format = $4)',
    [filter.day, filter.stage, filter.format],
  );
  if (filter.query === '') return rows;
  const query = parseQuery(filter.query);
  return rows.filter((row) =>
    matches(query, [row.title, ...row.speakers.flatMap((speaker) => [speaker.name, speaker.company])].map(fold)),
  );
}

export interface StageRecord {
  slug: string;
  name: string;
  description: string;
}

export async function listStages(db: Db): Promise<StageRecord[]> {
  const result = await db.query<StageRecord>('SELECT slug, name, description FROM stages ORDER BY position');
  return result.rows;
}

export interface SpeakerRecord {
  slug: string;
  name: string;
  company: string;
  sessions: string[];
  bio: string;
}

const SPEAKER_SELECT = `
  SELECT sp.slug, sp.name, sp.company, sp.bio,
         (SELECT coalesce(json_agg(s.id ORDER BY ${AGENDA_ORDER}), '[]')
            FROM session_speakers x JOIN sessions s ON s.id = x.session_id WHERE x.speaker_slug = sp.slug) AS sessions
  FROM speakers sp`;

export async function listSpeakers(db: Db): Promise<SpeakerRecord[]> {
  const result = await db.query<SpeakerRecord>(`${SPEAKER_SELECT} ORDER BY sp.position`);
  return result.rows;
}

export async function readSpeaker(db: Db, slug: string): Promise<SpeakerRecord | null> {
  const result = await db.query<SpeakerRecord>(`${SPEAKER_SELECT} WHERE sp.slug = $1`, [slug]);
  return result.rows[0] ?? null;
}
