import type { Database } from './pool.js';
import { fold } from '../domain/fold.js';

export interface StageRow {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
}

export interface SpeakerRefRow {
  readonly name: string;
  readonly company: string;
}

export interface SessionRow {
  readonly id: string;
  readonly day: number;
  readonly date: string;
  readonly start_local: string;
  readonly end_local: string;
  readonly start_instant: Date;
  readonly end_instant: Date;
  readonly title: string;
  readonly stage: string | null;
  readonly stage_name: string | null;
  readonly location: string | null;
  readonly format: string | null;
  readonly description: string;
  readonly capacity: number | null;
  readonly reserved: number;
  readonly held: number;
  readonly waitlist_count: number;
  readonly reserved_by_me: boolean;
  readonly saved_by_me: boolean;
  readonly waitlist_position: number | null;
  readonly my_hold_until: Date | null;
  readonly my_hold_seconds: number | null;
}

export interface Session extends SessionRow {
  readonly speakers: readonly SpeakerRefRow[];
  readonly foldedFields: readonly string[];
}

export interface SpeakerDetail {
  readonly slug: string;
  readonly name: string;
  readonly company: string;
  readonly bio: string;
  readonly sessions: readonly string[];
}

export interface OrganiserRow {
  readonly id: string;
  readonly title: string;
  readonly day: number;
  readonly start_local: string;
  readonly end_local: string;
  readonly start_instant: Date;
  readonly end_instant: Date;
  readonly capacity: number;
  readonly reserved: number;
  readonly held: number;
  readonly waitlisted: number;
}

export interface RosterRow {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly reserved_at: Date;
  /** The stored instant at full precision, so a cursor round-trips exactly. */
  readonly reserved_key: string;
}

export interface HoldRow {
  readonly session_id: string;
  readonly held_until: Date;
  readonly seconds_remaining: number;
}

const SESSION_COLUMNS = `
  s.id, s.day, to_char(s.date, 'YYYY-MM-DD') AS date, s.start_local, s.end_local,
  s.start_instant, s.end_instant, s.title, s.stage, st.name AS stage_name,
  s.location, s.format, s.description, s.capacity,
  (SELECT count(*)::int FROM reservations r WHERE r.session_id = s.id) AS reserved,
  (SELECT count(*)::int FROM holds h
     WHERE h.session_id = s.id AND h.settled_as IS NULL AND h.held_until > now()) AS held,
  (SELECT count(*)::int FROM waitlist_entries w WHERE w.session_id = s.id) AS waitlist_count,
  EXISTS (SELECT 1 FROM reservations rm WHERE rm.session_id = s.id AND rm.account_id = $1) AS reserved_by_me,
  EXISTS (SELECT 1 FROM saved_sessions sm WHERE sm.session_id = s.id AND sm.account_id = $1) AS saved_by_me,
  NULLIF((SELECT count(*)::int FROM waitlist_entries wa
            WHERE wa.session_id = s.id
              AND (wa.created_at, wa.id) <= (SELECT wm.created_at, wm.id FROM waitlist_entries wm
                                               WHERE wm.session_id = s.id AND wm.account_id = $1)), 0)
    AS waitlist_position,
  (SELECT hm.held_until FROM holds hm
     WHERE hm.session_id = s.id AND hm.account_id = $1
       AND hm.settled_as IS NULL AND hm.held_until > now()) AS my_hold_until,
  (SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (hs.held_until - now()))))::int FROM holds hs
     WHERE hs.session_id = s.id AND hs.account_id = $1
       AND hs.settled_as IS NULL AND hs.held_until > now()) AS my_hold_seconds`;

/** day, then venue start time, then stage order, then id. */
const AGENDA_ORDER = 'ORDER BY s.day, s.start_local, COALESCE(st.position, 4), s.id';

export class Reads {
  constructor(private readonly database: Database) {}

  async stages(): Promise<StageRow[]> {
    const result = await this.database.query<StageRow>(
      'SELECT slug, name, description FROM stages ORDER BY position',
    );
    return [...result.rows];
  }

  async sessions(account: number | null): Promise<Session[]> {
    const rows = await this.database.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions s LEFT JOIN stages st ON st.slug = s.stage ${AGENDA_ORDER}`,
      [account],
    );
    return this.attachSpeakers([...rows.rows]);
  }

  async session(id: string, account: number | null): Promise<Session | null> {
    const rows = await this.database.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions s LEFT JOIN stages st ON st.slug = s.stage WHERE s.id = $2`,
      [account, id],
    );
    const withSpeakers = await this.attachSpeakers([...rows.rows]);
    return withSpeakers[0] ?? null;
  }

  /** The sessions of one account's agenda group, by day then venue start time. */
  async sessionsForAgenda(account: number, group: 'reserved' | 'held' | 'waitlisted' | 'saved'): Promise<Session[]> {
    const membership: Record<typeof group, string> = {
      reserved: 'EXISTS (SELECT 1 FROM reservations x WHERE x.session_id = s.id AND x.account_id = $1)',
      held: `EXISTS (SELECT 1 FROM holds x WHERE x.session_id = s.id AND x.account_id = $1
                       AND x.settled_as IS NULL AND x.held_until > now())`,
      waitlisted: 'EXISTS (SELECT 1 FROM waitlist_entries x WHERE x.session_id = s.id AND x.account_id = $1)',
      saved: 'EXISTS (SELECT 1 FROM saved_sessions x WHERE x.session_id = s.id AND x.account_id = $1)',
    };
    const rows = await this.database.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions s LEFT JOIN stages st ON st.slug = s.stage
       WHERE ${membership[group]}
       ORDER BY s.day, s.start_local, s.id`,
      [account],
    );
    return this.attachSpeakers([...rows.rows]);
  }

  async holds(account: number): Promise<HoldRow[]> {
    const result = await this.database.query<HoldRow>(
      `SELECT session_id, held_until,
              GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (held_until - now()))))::int AS seconds_remaining
         FROM holds
        WHERE account_id = $1 AND settled_as IS NULL AND held_until > now()
        ORDER BY held_until, session_id`,
      [account],
    );
    return [...result.rows];
  }

  async speakers(): Promise<SpeakerDetail[]> {
    const result = await this.database.query<{
      slug: string;
      name: string;
      company: string;
      bio: string;
      sessions: string[];
    }>(
      `SELECT sp.slug, sp.name, sp.company, sp.bio,
              COALESCE(ARRAY(
                SELECT ss.session_id FROM session_speakers ss
                  JOIN sessions s ON s.id = ss.session_id
                  LEFT JOIN stages st ON st.slug = s.stage
                 WHERE ss.speaker_slug = sp.slug
                 ORDER BY s.day, s.start_local, COALESCE(st.position, 4), s.id
              ), '{}') AS sessions
         FROM speakers sp
        ORDER BY sp.position`,
    );
    return result.rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      company: row.company,
      bio: row.bio,
      sessions: row.sessions,
    }));
  }

  async speaker(slug: string): Promise<SpeakerDetail | null> {
    const all = await this.speakers();
    return all.find((candidate) => candidate.slug === slug) ?? null;
  }

  async saveSpeakerBio(slug: string, bio: string): Promise<boolean> {
    const result = await this.database.query('UPDATE speakers SET bio = $2 WHERE slug = $1', [slug, bio]);
    return result.rowCount !== 0;
  }

  async organiserRows(): Promise<OrganiserRow[]> {
    const result = await this.database.query<OrganiserRow>(
      `SELECT s.id, s.title, s.day, s.start_local, s.end_local, s.start_instant, s.end_instant, s.capacity,
              (SELECT count(*)::int FROM reservations r WHERE r.session_id = s.id) AS reserved,
              (SELECT count(*)::int FROM holds h
                 WHERE h.session_id = s.id AND h.settled_as IS NULL AND h.held_until > now()) AS held,
              (SELECT count(*)::int FROM waitlist_entries w WHERE w.session_id = s.id) AS waitlisted
         FROM sessions s LEFT JOIN stages st ON st.slug = s.stage
        WHERE s.capacity IS NOT NULL
        ${AGENDA_ORDER}`,
    );
    return [...result.rows];
  }

  async organiserRow(id: string): Promise<OrganiserRow | null> {
    const rows = await this.organiserRows();
    return rows.find((row) => row.id === id) ?? null;
  }

  async sessionCapacity(id: string): Promise<{ exists: boolean; capacity: number | null }> {
    const result = await this.database.query<{ capacity: number | null }>(
      'SELECT capacity FROM sessions WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? { exists: false, capacity: null } : { exists: true, capacity: row.capacity };
  }

  /** Reservations oldest first, cut by a cursor rather than by a row count. */
  async roster(
    sessionId: string,
    limit: number,
    after: { readonly createdAt: string; readonly id: number } | null,
  ): Promise<RosterRow[]> {
    const result = await this.database.query<RosterRow>(
      `SELECT r.id, a.name, a.email, r.created_at AS reserved_at,
              to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ') AS reserved_key
         FROM reservations r JOIN accounts a ON a.id = r.account_id
        WHERE r.session_id = $1
          AND ($2::timestamptz IS NULL OR (r.created_at, r.id) > ($2::timestamptz, $3::bigint))
        ORDER BY r.created_at, r.id
        LIMIT $4`,
      [sessionId, after?.createdAt ?? null, after?.id ?? null, limit],
    );
    return [...result.rows];
  }

  async setSaved(account: number, sessionId: string, saved: boolean): Promise<void> {
    if (saved) {
      await this.database.query(
        `INSERT INTO saved_sessions (session_id, account_id) VALUES ($1, $2)
         ON CONFLICT (account_id, session_id) DO NOTHING`,
        [sessionId, account],
      );
    } else {
      await this.database.query('DELETE FROM saved_sessions WHERE session_id = $1 AND account_id = $2', [
        sessionId,
        account,
      ]);
    }
  }

  private async attachSpeakers(rows: SessionRow[]): Promise<Session[]> {
    if (rows.length === 0) return [];
    const links = await this.database.query<{ session_id: string; name: string; company: string }>(
      `SELECT ss.session_id, sp.name, sp.company
         FROM session_speakers ss JOIN speakers sp ON sp.slug = ss.speaker_slug
        WHERE ss.session_id = ANY($1::text[])
        ORDER BY ss.session_id, ss.position`,
      [rows.map((row) => row.id)],
    );
    const bySession = new Map<string, SpeakerRefRow[]>();
    for (const link of links.rows) {
      const list = bySession.get(link.session_id) ?? [];
      list.push({ name: link.name, company: link.company });
      bySession.set(link.session_id, list);
    }
    return rows.map((row) => {
      const speakers = bySession.get(row.id) ?? [];
      return {
        ...row,
        speakers,
        foldedFields: [fold(row.title), ...speakers.flatMap((speaker) => [fold(speaker.name), fold(speaker.company)])],
      };
    });
  }
}
