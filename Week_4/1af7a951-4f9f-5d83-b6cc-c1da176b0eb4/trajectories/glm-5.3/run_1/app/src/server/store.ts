import type { Cohort, Constellation, Enrolment, Entry, RosterRow, SessionPayload, SharedEntry, Sign, SignCategory, Tallies } from '../shared/domain.js';
import { SIGN_CATEGORIES } from '../shared/domain.js';
import { emptyTallies, haloRadius, targetCategory } from '../shared/constellations.js';
import { recallRate } from '../shared/roster.js';
import { datePhaseFor, weekFor } from '../shared/phases.js';
import { nightNumberFor, snapshotFor, wakeAlarmFor } from '../shared/nights.js';
import { clockFor, formatInstantUTC } from '../shared/timezones.js';
import type { Db } from './db.js';

// The store owns every SQL query and every projection. Domain rules are in
// the shared modules; this file is the only place that touches rows.

export interface CoachContext {
  id: string;
  name: string;
  email: string;
  time_zone: string;
}

export interface CohortContext {
  id: string;
  name: string;
  coach_id: string;
  starts_on: string;
  price_cents: number;
  seats: number;
  published: boolean;
  closed_by_coach: boolean;
}

export interface EnrolmentContext extends Enrolment {
  paid_via_killbill: boolean;
  access_code: string;
}

export class Store {
  constructor(private readonly db: Db) {}

  // ---------- phases ----------

  todayFor(tz: string): string {
    return clockFor(tz).ymd(new Date());
  }

  async coachOf(coachId: string): Promise<CoachContext | null> {
    const rows = await this.db.query<CoachRowAlias>('SELECT id, name, email, time_zone FROM coaches WHERE id = $1', [coachId]);
    return rows[0] ?? null;
  }

  async cohortOf(cohortId: string): Promise<CohortContext | null> {
    const rows = await this.db.query<CohortRowAlias>(
      'SELECT id, coach_id, name, starts_on::text AS starts_on, price_cents, seats, published, closed_by_coach FROM cohorts WHERE id = $1',
      [cohortId],
    );
    return rows[0] ?? null;
  }

  phaseOf(cohort: CohortContext, today: string): { phase: Cohort['phase']; week: number | null } {
    if (!cohort.published) return { phase: 'draft', week: null };
    if (cohort.closed_by_coach) return { phase: 'closed', week: null };
    return { phase: datePhaseFor(cohort.starts_on, today, true), week: weekFor(cohort.starts_on, today) };
  }

  async cohortProjection(cohort: CohortContext, coachName: string, activeCount: number): Promise<Cohort> {
    const today = this.todayFor((await this.coachOf(cohort.coach_id))?.time_zone ?? 'UTC');
    const { phase, week } = this.phaseOf(cohort, today);
    return {
      id: cohort.id,
      name: cohort.name,
      coach_name: coachName,
      starts_on: cohort.starts_on,
      phase,
      week,
      price_cents: cohort.price_cents,
      seats: cohort.seats,
      seats_left: Math.max(0, cohort.seats - activeCount),
    };
  }

  async activeCount(cohortId: string): Promise<number> {
    const rows = await this.db.query<{ n: string }>('SELECT count(*)::text AS n FROM enrollments WHERE cohort_id = $1 AND status = $2', [cohortId, 'active']);
    return Number(rows[0]?.n ?? 0);
  }

  // ---------- enrolments ----------

  async enrolmentOf(id: string): Promise<EnrolmentContext | null> {
    const rows = await this.db.query<EnrolmentRowAlias>(
      `SELECT e.id, e.cohort_id, e.name, e.email, e.status, e.price_cents, e.home_tz, e.bedtime,
              e.first_night::text AS first_night, e.receipt_status, e.access_code, e.paid_via_killbill,
              c.name AS cohort_name
       FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id WHERE e.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      cohort_id: row.cohort_id,
      cohort_name: row.cohort_name,
      name: row.name,
      email: row.email,
      status: row.status,
      price_cents: row.price_cents,
      home_tz: row.home_tz,
      bedtime: row.bedtime,
      wake_alarm: wakeAlarmFor(row.bedtime),
      first_night: row.first_night,
      receipt_status: row.receipt_status,
      paid_via_killbill: row.paid_via_killbill,
      access_code: row.access_code,
    };
  }

  async enrolmentProjection(row: EnrolmentRowAlias): Promise<Enrolment> {
    return {
      id: row.id,
      cohort_id: row.cohort_id,
      cohort_name: row.cohort_name,
      name: row.name,
      email: row.email,
      status: row.status,
      price_cents: row.price_cents,
      home_tz: row.home_tz,
      bedtime: row.bedtime,
      wake_alarm: wakeAlarmFor(row.bedtime),
      first_night: row.first_night,
      receipt_status: row.receipt_status,
    };
  }

  async latestNightKey(enrolmentId: string): Promise<string | null> {
    const rows = await this.db.query<{ k: string | null }>('SELECT max(night_key)::text AS k FROM entries WHERE enrollment_id = $1', [enrolmentId]);
    return rows[0]?.k ?? null;
  }

  async nightSnapshot(enrolment: EnrolmentContext): Promise<{ night_key: string; night_number: number; capture_window: 'open' | 'closed' }> {
    const latest = await this.latestNightKey(enrolment.id);
    return snapshotFor(new Date(), enrolment.home_tz, enrolment.bedtime, enrolment.first_night, latest);
  }

  // ---------- entries ----------

  async entryOf(id: string): Promise<EntryRowAlias | null> {
    const rows = await this.db.query<EntryRowAlias>(
      `SELECT id, enrollment_id, cohort_id, night_key::text AS night_key, title, text, dreams_recalled,
              lucid, wbtb, technique, technique_minutes, late_recall, shared, created_at, body_hash
       FROM entries WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async signsForEntry(entryId: string): Promise<Sign[]> {
    const rows = await this.db.query<SignRowAlias>(
      `SELECT id, entry_id, enrollment_id, start_offset, end_offset, phrase, category, night_key::text AS night_key, created_at
       FROM signs WHERE entry_id = $1 ORDER BY created_at, id`,
      [entryId],
    );
    return rows.map(signProjection);
  }

  async entryProjection(row: EntryRowAlias, signs: Sign[], memo: Entry['memo'], firstNight: string | null): Promise<Entry> {
    return {
      id: row.id,
      night_key: row.night_key,
      night_number: nightNumberFor(row.night_key, firstNight),
      title: row.title,
      text: row.text,
      dreams_recalled: row.dreams_recalled,
      lucid: row.lucid,
      wbtb: row.wbtb,
      technique: row.technique as Entry['technique'],
      technique_minutes: row.technique_minutes,
      late_recall: row.late_recall,
      shared: row.shared,
      created_at: formatInstantUTC(new Date(row.created_at)),
      memo,
      signs,
    };
  }

  async memoOf(entryId: string): Promise<Entry['memo']> {
    const rows = await this.db.query<MemoRowAlias>(
      'SELECT entry_id, content_type, size_bytes, duration_ms, stored FROM memo_slots WHERE entry_id = $1 AND stored = TRUE',
      [entryId],
    );
    const row = rows[0];
    if (!row || row.content_type === null || row.duration_ms === null) return null;
    return { content_type: row.content_type, size_bytes: row.size_bytes ?? 0, duration_ms: row.duration_ms };
  }

  async entriesFor(enrolmentId: string): Promise<Entry[]> {
    const rows = await this.db.query<EntryRowAlias>(
      `SELECT id, enrollment_id, cohort_id, night_key::text AS night_key, title, text, dreams_recalled,
              lucid, wbtb, technique, technique_minutes, late_recall, shared, created_at, body_hash
       FROM entries WHERE enrollment_id = $1
       ORDER BY night_key DESC, created_at DESC, id DESC`,
      [enrolmentId],
    );
    const enrolment = rows.length > 0 ? await this.enrolmentOf(enrolmentId) : null;
    const out: Entry[] = [];
    for (const row of rows) {
      const signs = await this.signsForEntry(row.id);
      const memo = await this.memoOf(row.id);
      out.push(await this.entryProjection(row, signs, memo, enrolment?.first_night ?? null));
    }
    return out;
  }

  // ---------- dreamscape ----------

  async constellations(enrolmentId: string): Promise<{ constellations: Constellation[]; target: SignCategory | null }> {
    const rows = await this.db.query<{ category: string; stars: string; nights: string }>(
      `SELECT category, count(*)::text AS stars, count(DISTINCT night_key)::text AS nights
       FROM signs WHERE enrollment_id = $1 GROUP BY category`,
      [enrolmentId],
    );
    const tallies = emptyTallies();
    for (const row of rows) {
      if ((SIGN_CATEGORIES as readonly string[]).includes(row.category)) {
        tallies[row.category as SignCategory] = Number(row.stars);
      }
    }
    const constellations = SIGN_CATEGORIES.map((cat) => {
      const nights = Number(rows.find((r) => r.category === cat)?.nights ?? 0);
      return { category: cat, stars: tallies[cat], tagged_nights: nights, halo_px: haloRadius(nights) };
    });
    return { constellations, target: targetCategory(tallies) };
  }

  async talliesFor(enrolmentId: string): Promise<Tallies> {
    const rows = await this.db.query<{ category: string; n: string }>(
      'SELECT category, count(*)::text AS n FROM signs WHERE enrollment_id = $1 GROUP BY category',
      [enrolmentId],
    );
    const tallies = emptyTallies();
    for (const row of rows) {
      if ((SIGN_CATEGORIES as readonly string[]).includes(row.category)) tallies[row.category as SignCategory] = Number(row.n);
    }
    return tallies;
  }

  // ---------- roster ----------

  async roster(cohort: CohortContext): Promise<RosterRow[]> {
    const enrolments = await this.db.query<EnrolmentRowAlias & { nights: string }>(
      `SELECT e.id, e.cohort_id, e.name, e.email, e.status, e.price_cents, e.home_tz, e.bedtime,
              e.first_night::text AS first_night, e.receipt_status, c.name AS cohort_name,
              0 AS nights
       FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
       WHERE e.cohort_id = $1 ORDER BY e.name`,
      [cohort.id],
    );
    const out: RosterRow[] = [];
    for (const row of enrolments) {
      out.push(await this.rosterRow(row));
    }
    return out;
  }

  async rosterRow(row: EnrolmentRowAlias): Promise<RosterRow> {
    const stats = await this.db.query<{
      nights_logged: string;
      recalled: string;
      technique_minutes: string;
      wbtb: string;
    }>(
      `SELECT count(DISTINCT night_key)::text AS nights_logged,
              count(DISTINCT CASE WHEN dreams_recalled >= 1 THEN night_key END)::text AS recalled,
              COALESCE(sum(technique_minutes), 0)::text AS technique_minutes,
              count(DISTINCT CASE WHEN wbtb THEN night_key END)::text AS wbtb
       FROM entries WHERE enrollment_id = $1 AND night_key >= $2 AND night_key <= $3`,
      [row.id, row.first_night ?? '0001-01-01', addDaysSafe(row.first_night ?? '0001-01-01', 27)],
    );
    const checks = await this.db.query<{ n: string }>('SELECT count(*)::text AS n FROM reality_checks WHERE enrollment_id = $1', [row.id]);
    const tallies = await this.talliesFor(row.id);
    const latest = await this.latestNightKey(row.id);
    const snap = snapshotFor(new Date(), row.home_tz, row.bedtime, row.first_night, latest);
    const nightNumber = Math.min(snap.night_number, 28);
    const nightsElapsed = snap.night_number < 1 ? 0 : nightNumber;
    const recalled = Number(stats[0]?.recalled ?? 0);
    const shared = row.status === 'active' ? await this.sharedEntries(row.id) : [];
    return {
      enrollment_id: row.id,
      display_name: row.name,
      status: row.status,
      night_number: snap.night_number,
      nights_logged: Number(stats[0]?.nights_logged ?? 0),
      recall_rate: recallRate(recalled, nightsElapsed),
      technique_minutes: Number(stats[0]?.technique_minutes ?? 0),
      wbtb_nights: Number(stats[0]?.wbtb ?? 0),
      reality_checks: Number(checks[0]?.n ?? 0),
      sign_tallies: tallies,
      shared_entries: shared,
    };
  }

  async sharedEntries(enrolmentId: string): Promise<SharedEntry[]> {
    const rows = await this.db.query<{ id: string; night_key: string; title: string; text: string }>(
      `SELECT id, night_key::text AS night_key, title, text FROM entries
       WHERE enrollment_id = $1 AND shared = TRUE ORDER BY created_at, id`,
      [enrolmentId],
    );
    const out: SharedEntry[] = [];
    for (const row of rows) {
      const memo = await this.memoOf(row.id);
      out.push({ entry_id: row.id, night_key: row.night_key, title: row.title, text: row.text, has_memo: memo !== null });
    }
    return out;
  }

  // ---------- sessions ----------

  async sessionByToken(token: string): Promise<SessionPayload | null> {
    const rows = await this.db.query<{ role: string; coach_id: string | null; enrollment_id: string | null; name: string; id: string }>(
      `SELECT s.role, s.coach_id, s.enrollment_id, COALESCE(c.name, e.name) AS name, COALESCE(s.coach_id::text, s.enrollment_id::text) AS id
       FROM sessions s
       LEFT JOIN coaches c ON c.id = s.coach_id
       LEFT JOIN enrollments e ON e.id = s.enrollment_id
       WHERE s.token = $1`,
      [token],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.role === 'coach' && row.coach_id !== null) {
      const coach = await this.coachOf(row.coach_id);
      if (!coach) return null;
      return { role: 'coach', name: coach.name, id: coach.id };
    }
    if (row.role === 'dreamer' && row.enrollment_id !== null) {
      const enrolment = await this.enrolmentOf(row.enrollment_id);
      if (!enrolment || enrolment.status !== 'active') return null;
      return { role: 'dreamer', name: enrolment.name, id: enrolment.id };
    }
    return null;
  }

  async endSessionsOfEnrolment(enrolmentId: string): Promise<void> {
    await this.db.exec('DELETE FROM sessions WHERE enrollment_id = $1', [enrolmentId]);
  }
}

interface CoachRowAlias {
  id: string;
  name: string;
  email: string;
  time_zone: string;
}

interface CohortRowAlias {
  id: string;
  coach_id: string;
  name: string;
  starts_on: string;
  price_cents: number;
  seats: number;
  published: boolean;
  closed_by_coach: boolean;
}

export interface EnrolmentRowAlias {
  id: string;
  cohort_id: string;
  name: string;
  email: string;
  status: 'pending_payment' | 'active' | 'refunded';
  price_cents: number;
  home_tz: string;
  bedtime: string;
  first_night: string | null;
  receipt_status: 'none' | 'pending' | 'sent';
  access_code: string;
  paid_via_killbill: boolean;
  cohort_name: string;
}

interface EntryRowAlias {
  id: string;
  enrollment_id: string;
  cohort_id: string;
  night_key: string;
  title: string;
  text: string;
  dreams_recalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: string;
  technique_minutes: number;
  late_recall: boolean;
  shared: boolean;
  created_at: string;
  body_hash: string;
}

interface SignRowAlias {
  id: string;
  entry_id: string;
  enrollment_id: string;
  start_offset: number;
  end_offset: number;
  phrase: string;
  category: string;
  night_key: string;
  created_at: string;
}

interface MemoRowAlias {
  entry_id: string;
  content_type: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  stored: boolean;
}

function signProjection(row: SignRowAlias): Sign {
  return {
    id: row.id,
    entry_id: row.entry_id,
    start: row.start_offset,
    end: row.end_offset,
    phrase: row.phrase,
    category: row.category as SignCategory,
    night_key: row.night_key,
  };
}

function addDaysSafe(key: string, days: number): string {
  const dt = new Date(Date.parse(`${key}T00:00:00Z`));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
