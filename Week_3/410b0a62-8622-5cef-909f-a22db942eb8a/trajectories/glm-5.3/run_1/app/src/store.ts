import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { pool, type Queryable } from './db.js';
import type { LocalDate } from './dates.js';
import { addDays, wallClockToInstant } from './dates.js';
import { thresholdInForce, stateFromRatio, type ComplianceState, type Step, type ThresholdEntry } from './domain.js';
import { notFound } from './errors.js';
import { ObjectStorage } from './storage.js';
import type {
  CommentJson,
  ItemJson,
  SeriesRow,
  Sport,
  ThresholdRow,
  UserRow,
  WorkoutRow,
  WorkoutSource,
  LiveChangeEvent,
} from './types.js';
import { workoutToJson } from './types.js';

export interface ChangeNotifier {
  (event: LiveChangeEvent, notice?: { toUserId: string; text: string }): void;
}

export interface StoreDeps {
  storage: ObjectStorage;
  today: () => LocalDate;
  notify: ChangeNotifier;
}

const WORKOUT_SELECT = `SELECT w.id, w.athlete_id, w.kind, w.sport, w.title, to_char(w.date,'YYYY-MM-DD') as date,
  w.start_local, w.start_utc::text as start_utc, w.duration_s, w.steps, w.planned_tss, w.planned_if,
  w.tss, w.if, w.np_w, w.ns_mps, w.source, w.version, w.file_name, w.file_size, w.file_sha256, w.file_content_type,
  w.created_at
  FROM workouts w`;

interface WorkoutDbRow {
  id: string;
  athlete_id: string;
  kind: 'planned' | 'completed';
  sport: Sport;
  title: string;
  date: string;
  start_local: string | null;
  start_utc: string | null;
  duration_s: number;
  steps: Step[] | null;
  planned_tss: number | null;
  planned_if: number | null;
  tss: number | null;
  if: number | null;
  np_w: number | null;
  ns_mps: number | null;
  source: WorkoutSource;
  version: number;
  file_name: string | null;
  file_size: number | null;
  file_sha256: string | null;
  file_content_type: string | null;
  created_at: Date;
}

function toWorkoutRow(r: WorkoutDbRow): WorkoutRow {
  return {
    ...r,
    date: r.date,
    steps: r.steps ?? null,
    start_utc: r.start_utc ? r.start_utc.replace('T', 'T') : null,
  };
}

export class Store {
  private deps: StoreDeps;
  readonly db: Pool = pool;

  constructor(deps: StoreDeps) {
    this.deps = deps;
  }

  storage(): ObjectStorage {
    return this.deps.storage;
  }

  // ---------------------------------------------------------------- users

  async createUser(client: Queryable, user: {
    role: 'athlete' | 'coach';
    name: string;
    email: string;
    password: string;
    tz: string;
    coach_code?: string | null;
    series_start?: LocalDate | null;
    start_ctl?: number;
    start_atl?: number;
  }): Promise<UserRow> {
    const id = randomUUID();
    const hash = bcrypt.hashSync(user.password, 10);
    await client.query(
      `INSERT INTO users (id, role, name, email, password_hash, tz, coach_code, series_start, start_ctl, start_atl)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        user.role,
        user.name,
        user.email.toLowerCase(),
        hash,
        user.tz,
        user.coach_code ?? null,
        user.series_start ?? null,
        user.start_ctl ?? 0,
        user.start_atl ?? 0,
      ]
    );
    const row = await this.getUser(client, id);
    return row;
  }

  async getUser(client: Queryable, id: string): Promise<UserRow> {
    const res = await client.query(
      `SELECT id, role, name, email, tz, coach_code, to_char(series_start,'YYYY-MM-DD') as series_start, start_ctl, start_atl
       FROM users WHERE id = $1`,
      [id]
    );
    if (res.rows.length === 0) throw notFound();
    return res.rows[0] as UserRow;
  }

  async findByEmail(client: Queryable, email: string): Promise<UserRow | null> {
    const res = await client.query(
      `SELECT id, role, name, email, tz, coach_code, to_char(series_start,'YYYY-MM-DD') as series_start, start_ctl, start_atl
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    return (res.rows[0] as UserRow | undefined) ?? null;
  }

  async findByCoachCode(client: Queryable, code: string): Promise<UserRow | null> {
    const res = await client.query(
      `SELECT id, role, name, email, tz, coach_code, to_char(series_start,'YYYY-MM-DD') as series_start, start_ctl, start_atl
       FROM users WHERE coach_code = $1 AND role = 'coach'`,
      [code]
    );
    return (res.rows[0] as UserRow | undefined) ?? null;
  }

  async findUserByToken(client: Queryable, token: string): Promise<UserRow | null> {
    const res = await client.query(
      `SELECT u.id, u.role, u.name, u.email, u.tz, u.coach_code, to_char(u.series_start,'YYYY-MM-DD') as series_start, u.start_ctl, u.start_atl
       FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = $1`,
      [token]
    );
    return (res.rows[0] as UserRow | undefined) ?? null;
  }

  async createSession(client: Queryable, userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await client.query(`INSERT INTO sessions (token, user_id) VALUES ($1,$2)`, [token, userId]);
    return token;
  }

  async deleteSession(client: Queryable, token: string): Promise<void> {
    await client.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  }

  async createOneTimeToken(client: Queryable, userId: string): Promise<string> {
    const token = randomBytes(24).toString('hex');
    await client.query(`INSERT INTO one_time_tokens (token, user_id) VALUES ($1,$2)`, [token, userId]);
    return token;
  }

  async consumeOneTimeToken(client: Queryable, token: string): Promise<UserRow | null> {
    const res = await client.query(
      `SELECT user_id FROM one_time_tokens WHERE token = $1 AND used = false`,
      [token]
    );
    if (res.rows.length === 0) return null;
    await client.query(`UPDATE one_time_tokens SET used = true WHERE token = $1`, [token]);
    return this.getUser(client, res.rows[0].user_id as string);
  }

  async setPassword(client: Queryable, userId: string, password: string): Promise<void> {
    const hash = bcrypt.hashSync(password, 10);
    await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
  }

  // ---------------------------------------------------------------- visibility

  async canViewAthlete(client: Queryable, viewerId: string, athleteId: string): Promise<UserRow> {
    const athlete = await client.query(`SELECT id, role FROM users WHERE id = $1`, [athleteId]);
    if (athlete.rows.length === 0 || (athlete.rows[0] as { role: string }).role !== 'athlete') throw notFound();
    if (viewerId === athleteId) return this.getUser(client, athleteId);
    const link = await client.query(
      `SELECT 1 FROM links WHERE coach_id = $1 AND athlete_id = $2 AND status = 'accepted'`,
      [viewerId, athleteId]
    );
    if (link.rows.length === 0) throw notFound();
    return this.getUser(client, athleteId);
  }

  /** The athlete's most recent completed workout as a calendar item, for the coach dashboard. */
  async latestItem(client: Queryable, athleteId: string): Promise<ItemJson | null> {
    const res = await client.query(
      `${WORKOUT_SELECT} WHERE w.athlete_id = $1 AND w.kind = 'completed' ORDER BY w.date DESC, w.created_at DESC LIMIT 1`,
      [athleteId]
    );
    if (res.rows.length === 0) return null;
    const workout = toWorkoutRow(res.rows[0] as WorkoutDbRow);
    const day = await this.weekItems(client, athleteId, [workout.date]);
    const items = day.get(workout.date) ?? [];
    return items.find((i) => i.completed?.id === workout.id) ?? null;
  }

  async linkedAthletes(client: Queryable, coachId: string): Promise<UserRow[]> {
    const res = await client.query(
      `SELECT u.id, u.role, u.name, u.email, u.tz, u.coach_code, to_char(u.series_start,'YYYY-MM-DD') as series_start, u.start_ctl, u.start_atl
       FROM users u JOIN links l ON l.athlete_id = u.id
       WHERE l.coach_id = $1 AND l.status = 'accepted' ORDER BY u.name`,
      [coachId]
    );
    return res.rows as UserRow[];
  }

  // ---------------------------------------------------------------- workouts

  async getWorkout(client: Queryable, id: string): Promise<WorkoutRow> {
    const res = await client.query(`${WORKOUT_SELECT} WHERE w.id = $1`, [id]);
    if (res.rows.length === 0) throw notFound();
    return toWorkoutRow(res.rows[0] as WorkoutDbRow);
  }

  async getWorkoutsForRange(
    client: Queryable,
    athleteId: string,
    from: LocalDate,
    to: LocalDate
  ): Promise<WorkoutRow[]> {
    const res = await client.query(
      `${WORKOUT_SELECT} WHERE w.athlete_id = $1 AND w.date >= $2 AND w.date <= $3 ORDER BY w.date, w.created_at`,
      [athleteId, from, to]
    );
    return (res.rows as WorkoutDbRow[]).map(toWorkoutRow);
  }

  async recentCompleted(client: Queryable, athleteId: string, limit: number): Promise<WorkoutRow[]> {
    const res = await client.query(
      `${WORKOUT_SELECT} WHERE w.athlete_id = $1 AND w.kind = 'completed' ORDER BY w.date DESC, w.created_at DESC LIMIT $2`,
      [athleteId, limit]
    );
    return (res.rows as WorkoutDbRow[]).map(toWorkoutRow);
  }

  async insertWorkout(
    client: Queryable,
    w: {
      athlete_id: string;
      kind: 'planned' | 'completed';
      sport: Sport;
      title: string;
      date: LocalDate;
      start_local?: string | null;
      duration_s: number;
      steps?: Step[] | null;
      planned_tss?: number | null;
      planned_if?: number | null;
      tss?: number | null;
      if?: number | null;
      np_w?: number | null;
      ns_mps?: number | null;
      source: WorkoutSource;
      file_name?: string | null;
      file_size?: number | null;
      file_sha256?: string | null;
      file_content_type?: string | null;
    }
  ): Promise<WorkoutRow> {
    const id = randomUUID();
    const tz = await this.getUserTz(client, w.athlete_id);
    const startUtc = w.start_local ? new Date(wallClockToInstant(tz, w.date, w.start_local) * 1000).toISOString() : null;
    await client.query(
      `INSERT INTO workouts (id, athlete_id, kind, sport, title, date, start_local, start_utc, duration_s, steps,
        planned_tss, planned_if, tss, if, np_w, ns_mps, source, version, file_name, file_size, file_sha256, file_content_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1,$18,$19,$20,$21)`,
      [
        id, w.athlete_id, w.kind, w.sport, w.title, w.date, w.start_local ?? null, startUtc, w.duration_s,
        w.steps ? JSON.stringify(w.steps) : null, w.planned_tss ?? null, w.planned_if ?? null, w.tss ?? null,
        w.if ?? null, w.np_w ?? null, w.ns_mps ?? null, w.source, w.file_name ?? null, w.file_size ?? null,
        w.file_sha256 ?? null, w.file_content_type ?? null,
      ]
    );
    return this.getWorkout(client, id);
  }

  private async getUserTz(client: Queryable, userId: string): Promise<string> {
    const res = await client.query(`SELECT tz FROM users WHERE id = $1`, [userId]);
    return (res.rows[0] as { tz: string }).tz;
  }

  // ---------------------------------------------------------------- thresholds

  async thresholds(client: Queryable, athleteId: string): Promise<ThresholdRow[]> {
    const res = await client.query(
      `SELECT id, athlete_id, kind, value, to_char(effective_from,'YYYY-MM-DD') as effective_from
       FROM thresholds WHERE athlete_id = $1 ORDER BY effective_from, kind`,
      [athleteId]
    );
    return res.rows as ThresholdRow[];
  }

  async addThreshold(
    client: Queryable,
    athleteId: string,
    kind: 'ftp' | 'pace',
    value: number,
    effectiveFrom: LocalDate
  ): Promise<{ threshold: ThresholdRow; rescored: number; replaced: boolean }> {
    const existing = await client.query(
      `SELECT id FROM thresholds WHERE athlete_id = $1 AND kind = $2 AND effective_from = $3`,
      [athleteId, kind, effectiveFrom]
    );
    const replaced = existing.rows.length > 0;
    let thresholdId: string;
    if (replaced) {
      thresholdId = (existing.rows[0] as { id: string }).id;
      await client.query(`UPDATE thresholds SET value = $1 WHERE id = $2`, [value, thresholdId]);
    } else {
      thresholdId = randomUUID();
      await client.query(
        `INSERT INTO thresholds (id, athlete_id, kind, value, effective_from) VALUES ($1,$2,$3,$4,$5)`,
        [thresholdId, athleteId, kind, value, effectiveFrom]
      );
    }
    const rescored = await this.rescoreFrom(client, athleteId, kind, effectiveFrom);
    const row = (await client.query(
      `SELECT id, athlete_id, kind, value, to_char(effective_from,'YYYY-MM-DD') as effective_from FROM thresholds WHERE id = $1`,
      [thresholdId]
    )).rows[0] as ThresholdRow;
    return { threshold: row, rescored, replaced };
  }

  /** Re-scores completed workouts of the sport from `from` to the next later entry's day-before. */
  private async rescoreFrom(
    client: Queryable,
    athleteId: string,
    kind: 'ftp' | 'pace',
    from: LocalDate
  ): Promise<number> {
    const all = await this.thresholds(client, athleteId);
    const nextLater = all
      .filter((t) => t.kind === kind && t.effective_from > from)
      .sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1))[0];
    const until = nextLater ? addDays(nextLater.effective_from, -1) : '9999-12-31';
    const entries = all as ThresholdEntry[];
    const sport = kind === 'ftp' ? 'bike' : 'run';
    const workouts = await client.query(
      `SELECT id, to_char(date,'YYYY-MM-DD') as date, np_w, ns_mps, duration_s, steps, planned_tss
       FROM workouts WHERE athlete_id = $1 AND kind = 'completed' AND sport = $2 AND date >= $3 AND date <= $4`,
      [athleteId, sport, from, until]
    );
    let count = 0;
    for (const row of workouts.rows as {
      id: string;
      date: string;
      np_w: number | null;
      ns_mps: number | null;
      duration_s: number;
      steps: Step[] | null;
      planned_tss: number | null;
    }[]) {
      const threshold = thresholdInForce(entries, kind, row.date);
      if (threshold === null) continue;
      if (kind === 'ftp' && row.np_w !== null) {
        const s = scoreRideFromNp(row.np_w, row.duration_s, threshold);
        await client.query(`UPDATE workouts SET if = $1, tss = $2 WHERE id = $3`, [s.if, s.tss, row.id]);
        count++;
      } else if (kind === 'pace' && row.ns_mps !== null) {
        const s = scoreRunFromNs(row.ns_mps, row.duration_s, threshold);
        await client.query(`UPDATE workouts SET if = $1, tss = $2 WHERE id = $3`, [s.if, s.tss, row.id]);
        count++;
      }
    }
    return count;
  }

  // ---------------------------------------------------------------- series

  async seriesRange(client: Queryable, athleteId: string, from: LocalDate, to: LocalDate): Promise<SeriesRow[]> {
    const res = await client.query(
      `SELECT athlete_id, to_char(date,'YYYY-MM-DD') as date, tss, ctl, atl, tsb FROM series_days
       WHERE athlete_id = $1 AND date >= $2 AND date <= $3 ORDER BY date`,
      [athleteId, from, to]
    );
    return res.rows as SeriesRow[];
  }

  /** Recomputes the stored daily series from `from` (inclusive) to today. */
  async recomputeSeries(client: Queryable, athleteId: string, from: LocalDate): Promise<void> {
    const user = await this.getUser(client, athleteId);
    if (!user.series_start) return;
    const today = this.deps.today();
    if (from > today) return;
    const start = from < user.series_start ? user.series_start : from;
    const tssRes = await client.query(
      `SELECT to_char(date,'YYYY-MM-DD') as date, COALESCE(SUM(tss),0) as tss FROM workouts
       WHERE athlete_id = $1 AND kind = 'completed' GROUP BY date`,
      [athleteId]
    );
    const daily = new Map<string, number>();
    for (const row of tssRes.rows as { date: string; tss: string | number }[]) {
      daily.set(row.date, Number(row.tss));
    }
    // Seed the recurrence with the day before `start`, or the athlete's start values.
    let prevCtl: number;
    let prevAtl: number;
    if (start <= user.series_start) {
      prevCtl = user.start_ctl;
      prevAtl = user.start_atl;
    } else {
      const before = await client.query(
        `SELECT ctl, atl FROM series_days WHERE athlete_id = $1 AND date = $2`,
        [athleteId, addDays(start, -1)]
      );
      if (before.rows.length === 0) {
        prevCtl = user.start_ctl;
        prevAtl = user.start_atl;
      } else {
        const r = before.rows[0] as { ctl: number; atl: number };
        prevCtl = r.ctl;
        prevAtl = r.atl;
      }
    }
    const days: SeriesRow[] = [];
    let ctl = prevCtl;
    let atl = prevAtl;
    for (let d = start; d <= today; d = addDays(d, 1)) {
      const tss = daily.get(d) ?? 0;
      ctl = ctl + (tss - ctl) / 42;
      atl = atl + (tss - atl) / 7;
      const tsb = prevCtl - prevAtl;
      days.push({ athlete_id: athleteId, date: d, tss, ctl, atl, tsb });
      prevCtl = ctl;
      prevAtl = atl;
    }
    await client.query(`DELETE FROM series_days WHERE athlete_id = $1 AND date >= $2`, [athleteId, start]);
    for (const day of days) {
      await client.query(
        `INSERT INTO series_days (athlete_id, date, tss, ctl, atl, tsb) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (athlete_id, date) DO UPDATE SET tss = EXCLUDED.tss, ctl = EXCLUDED.ctl, atl = EXCLUDED.atl, tsb = EXCLUDED.tsb`,
        [day.athlete_id, day.date, day.tss, day.ctl, day.atl, day.tsb]
      );
    }
  }

  async fullSeries(client: Queryable, athleteId: string): Promise<SeriesRow[]> {
    const user = await this.getUser(client, athleteId);
    if (!user.series_start) return [];
    const today = this.deps.today();
    return this.seriesRange(client, athleteId, user.series_start, today);
  }

  // ---------------------------------------------------------------- compliance

  async weekItems(client: Queryable, athleteId: string, days: LocalDate[]): Promise<Map<LocalDate, ItemJson[]>> {
    const workouts = await this.getWorkoutsForRange(client, athleteId, days[0]!, days[days.length - 1]!);
    const today = this.deps.today();
    const byDate = new Map<LocalDate, WorkoutRow[]>();
    for (const w of workouts) {
      const list = byDate.get(w.date) ?? [];
      list.push(w);
      byDate.set(w.date, list);
    }
    const items = new Map<LocalDate, ItemJson[]>();
    for (const date of days) {
      const dayWorkouts = byDate.get(date) ?? [];
      items.set(date, this.buildDayItems(dayWorkouts, date, today));
    }
    return items;
  }

  private buildDayItems(dayWorkouts: WorkoutRow[], date: LocalDate, today: LocalDate): ItemJson[] {
    const planned = dayWorkouts
      .filter((w) => w.kind === 'planned')
      .sort((a, b) => sortKey(a) - sortKey(b));
    const completed = dayWorkouts
      .filter((w) => w.kind === 'completed')
      .sort((a, b) => sortKey(a) - sortKey(b));
    const items: ItemJson[] = [];
    let ci = 0;
    for (const p of planned) {
      const match = completed[ci];
      if (match !== undefined && match.sport === p.sport) {
        const plannedValue = p.planned_tss ?? p.duration_s;
        const ratio = plannedValue > 0 ? (match.tss ?? 0) / plannedValue : null;
        const state: ComplianceState =
          p.planned_tss === null && plannedValue === 0
            ? date < today ? 'missed' : 'planned'
            : ratio !== null
              ? stateFromRatio(ratio)
              : date < today ? 'missed' : 'planned';
        items.push({
          planned: workoutToJson(p),
          completed: workoutToJson(match),
          compliance: state,
          ratio,
        });
        ci++;
      } else {
        items.push({
          planned: workoutToJson(p),
          completed: null,
          compliance: date < today ? 'missed' : 'planned',
          ratio: null,
        });
      }
    }
    for (let i = ci; i < completed.length; i++) {
      const c = completed[i]!;
      items.push({ planned: null, completed: workoutToJson(c), compliance: 'unplanned', ratio: null });
    }
    return items;
  }

  // ---------------------------------------------------------------- events

  async events(client: Queryable, athleteId: string): Promise<{ id: string; athlete_id: string; name: string; date: string }[]> {
    const res = await client.query(
      `SELECT id, athlete_id, name, to_char(date,'YYYY-MM-DD') as date FROM events WHERE athlete_id = $1 ORDER BY date`,
      [athleteId]
    );
    return res.rows as { id: string; athlete_id: string; name: string; date: string }[];
  }

  // ---------------------------------------------------------------- comments

  async comments(client: Queryable, workoutId: string): Promise<CommentJson[]> {
    const res = await client.query(
      `SELECT c.id, c.author_id, u.name as author_name, c.body, to_char(c.created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') as created_at
       FROM comments c JOIN users u ON u.id = c.author_id WHERE c.workout_id = $1 ORDER BY c.created_at`,
      [workoutId]
    );
    return res.rows as CommentJson[];
  }

  // ---------------------------------------------------------------- live

  notifyWorkouts(athleteId: string): void {
    this.deps.notify({ athlete_id: athleteId, what: 'workouts' });
  }

  notifySeries(athleteId: string): void {
    this.deps.notify({ athlete_id: athleteId, what: 'series' });
  }

  notifyComments(athleteId: string, workoutId: string): void {
    this.deps.notify({ athlete_id: athleteId, what: 'comments', workout_id: workoutId });
  }

  notifyThresholds(athleteId: string): void {
    this.deps.notify({ athlete_id: athleteId, what: 'thresholds' });
  }

  notifyEvents(athleteId: string): void {
    this.deps.notify({ athlete_id: athleteId, what: 'events' });
  }

  notifyLinks(coachId: string, athleteId: string): void {
    this.deps.notify({ athlete_id: athleteId, what: 'links' });
    this.deps.notify({ athlete_id: coachId, what: 'links' });
  }

  notifyUser(userId: string, text: string): void {
    this.deps.notify({ athlete_id: userId, what: 'workouts' }, { toUserId: userId, text });
  }
}

function sortKey(w: WorkoutRow): number {
  if (w.start_local) {
    const [h, m] = w.start_local.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }
  return 24 * 60;
}

function scoreRideFromNp(np: number, durationS: number, ftp: number): { if: number; tss: number } {
  const intensity = np / ftp;
  const tss = (durationS * np * intensity) / (ftp * 3600) * 100;
  return { if: intensity, tss };
}

function scoreRunFromNs(ns: number, durationS: number, thresholdPace: number): { if: number; tss: number } {
  const thresholdSpeed = 1000 / thresholdPace;
  const intensity = ns / thresholdSpeed;
  const tss = (durationS / 3600) * intensity ** 2 * 100;
  return { if: intensity, tss };
}

