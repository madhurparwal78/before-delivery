import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTransaction, type Queryable } from './db.js';
import type { LocalDate } from './dates.js';
import { wallClockToInstant } from './dates.js';
import {
  plannedIf,
  scoreManualBike,
  scoreManualRun,
  stepsDuration,
  stepsPlannedTss,
  thresholdInForce,
  type Step,
  type ThresholdEntry,
} from './domain.js';
import { ValidationError } from './errors.js';
import { sha256Hex } from './config.js';
import { parseCsvFile, parseJsonFile, checkChannel, checkSampleCount, normalisedPower, normalisedSpeed } from './scoring.js';
import type { Store } from './store.js';
import { storageKeyFor, contentTypeFor } from './keys.js';
import type { Sport } from './types.js';

export interface SeedBody {
  today?: unknown;
  users?: unknown;
  links?: unknown;
  files?: unknown;
  library?: unknown;
  workouts?: unknown;
  comments?: unknown;
  plans?: unknown;
  events?: unknown;
}

export interface SeedResult {
  today: LocalDate;
  ids: Record<string, string>;
  sign_in: Record<string, string>;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

export class Seeder {
  constructor(
    private pool: Pool,
    private store: Store,
    private deps: {
      today: () => LocalDate;
      config: { activityMaxBytes: number; activityMaxSamples: number; linkRequestTtlHours: number };
      resetToday: (date: LocalDate | null) => void;
    }
  ) {}

  async isSeeded(): Promise<boolean> {
    const res = await this.pool.query(`SELECT value FROM app_meta WHERE key = 'demo_seeded'`);
    return res.rows.length > 0;
  }

  async markSeeded(): Promise<void> {
    await this.pool.query(
      `INSERT INTO app_meta (key, value) VALUES ('demo_seeded','1') ON CONFLICT (key) DO NOTHING`
    );
  }

  async reset(): Promise<void> {
    await withTransaction(async (client) => {
      for (const table of [
        'comments',
        'series_days',
        'workouts',
        'events',
        'library_items',
        'plans',
        'links',
        'one_time_tokens',
        'sessions',
        'thresholds',
        'users',
        'seed_keys',
      ]) {
        await client.query(`DELETE FROM ${table}`);
      }
      await client.query(`DELETE FROM app_meta WHERE key = 'demo_seeded'`);
    });
    this.deps.resetToday(null);
  }

  async loadDemoSet(): Promise<void> {
    if (await this.isSeeded()) return;
    await this.seed(demoBody(), true);
    await this.markSeeded();
  }

  async seed(body: SeedBody, isDemo: boolean): Promise<SeedResult> {
    const parsed = parseSeedBody(body);
    // A seed on a database that still holds the demo set first removes the demo
    // set; seeding again upserts by key and returns the same ids.
    if (isDemo || (await this.isSeeded())) {
      await this.reset();
      if (isDemo) await this.markSeeded();
    }
    const ids: Record<string, string> = {};
    const sign_in: Record<string, string> = {};
    const previous = await this.seedKeyIds();

    await withTransaction(async (client) => {
      for (const u of parsed.users) {
        const id = await this.upsertUser(client, u, previous.get(`user:${u.key}`));
        ids[u.key] = id;
        await client.query(
          `INSERT INTO seed_keys (key, entity_type, entity_id) VALUES ($1,'user',$2)
           ON CONFLICT (key) DO UPDATE SET entity_id = EXCLUDED.entity_id`,
          [`user:${u.key}`, id]
        );
      }
      // thresholds are embedded in users
      for (const u of parsed.users) {
        for (const t of u.thresholds) {
          await client.query(
            `INSERT INTO thresholds (id, athlete_id, kind, value, effective_from) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (athlete_id, kind, effective_from) DO UPDATE SET value = EXCLUDED.value`,
            [randomUUID(), ids[u.key]!, t.kind, t.value, t.effective_from]
          );
        }
      }
      for (const f of parsed.files) {
        ids[f.key] = randomUUID();
      }
      for (const lib of parsed.library) {
        const id = previous.get(`library:${lib.key}`) ?? randomUUID();
        ids[lib.key] = id;
        await client.query(
          `INSERT INTO library_items (id, owner_id, name, sport, steps, duration_s, planned_tss, planned_if)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO NOTHING`,
          [
            id,
            ids[lib.owner]!,
            lib.name,
            lib.sport,
            JSON.stringify(lib.steps),
            stepsDuration(lib.steps),
            stepsPlannedTss(lib.steps),
            plannedIf(lib.steps),
          ]
        );
        await this.recordKey(client, `library:${lib.key}`, id);
      }
      const workoutIdByKey = new Map<string, string>();
      for (const w of parsed.workouts) {
        workoutIdByKey.set(w.key, previous.get(`workout:${w.key}`) ?? randomUUID());
      }
      for (const e of parsed.events) {
        const id = previous.get(`event:${e.key}`) ?? randomUUID();
        ids[e.key] = id;
        await client.query(
          `INSERT INTO events (id, athlete_id, name, date) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO NOTHING`,
          [id, ids[e.athlete]!, e.name, e.date]
        );
        await this.recordKey(client, `event:${e.key}`, id);
      }
      for (const w of parsed.workouts) {
        const athleteId = ids[w.athlete]!;
        const athlete = await this.store.getUser(client, athleteId);
        if (w.kind === 'planned') {
          const steps = w.steps ?? null;
          await client.query(
            `INSERT INTO workouts (id, athlete_id, kind, sport, title, date, start_local, start_utc, duration_s, steps,
              planned_tss, planned_if, source, version)
             VALUES ($1,$2,'planned',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1)
             ON CONFLICT (id) DO NOTHING`,
            [
              workoutIdByKey.get(w.key)!,
              athleteId,
              w.sport,
              w.title,
              w.date,
              w.start_local ?? null,
              w.start_local ? new Date(wallClockToInstant(athlete.tz, w.date, w.start_local) * 1000).toISOString() : null,
              steps ? stepsDuration(steps) : w.duration_s ?? 3600,
              steps ? JSON.stringify(steps) : null,
              steps ? stepsPlannedTss(steps) : null,
              steps ? plannedIf(steps) : null,
              w.source ?? 'builder',
            ]
          );
        } else {
          const duration = w.manual ? w.manual.duration_s : 0;
          let tss: number | null = null;
          let intensity: number | null = null;
          let npW: number | null = null;
          let nsMps: number | null = null;
          let fileName: string | null = null;
          let fileSize: number | null = null;
          let fileSha: string | null = null;
          let fileType: string | null = null;
          let date = w.date ?? null;
          if (w.manual) {
            const entries = (await this.store.thresholds(client, athleteId)) as unknown as ThresholdEntry[];
            const threshold =
              w.manual.kind === 'bike' ? thresholdInForce(entries, 'ftp', w.date!) : thresholdInForce(entries, 'pace', w.date!);
            if (threshold !== null) {
              if (w.manual.kind === 'bike') {
                const s = scoreManualBike(w.manual.duration_s, w.manual.avg_power_w, threshold);
                intensity = s.if;
                tss = s.tss;
                npW = w.manual.avg_power_w;
              } else {
                const s = scoreManualRun(w.manual.duration_s, w.manual.avg_pace_s_per_km, threshold);
                intensity = s.if;
                tss = s.tss;
                nsMps = 1000 / w.manual.avg_pace_s_per_km;
              }
            }
          } else if (w.file !== undefined) {
            const file = parsed.files.find((f) => f.key === w.file)!;
            const bytes = Buffer.from(file.content_base64, 'base64');
            const isCsv = file.name.toLowerCase().endsWith('.csv');
            const samples = isCsv
              ? (await parseCsvFile(bytes)).samples
              : (await parseJsonFile(bytes)).samples;
            checkChannel(w.sport, samples);
            checkSampleCount(samples.length, this.deps.config.activityMaxSamples);
            if (!isCsv) {
              const parsedJson = parseJsonFile(bytes);
              if (typeof parsedJson.start === 'string') {
                const start = parseSeedStart(parsedJson.start, athlete.tz);
                date = start.date;
              }
            }
            const entries = (await this.store.thresholds(client, athleteId)) as unknown as ThresholdEntry[];
            const threshold =
              w.sport === 'bike' ? thresholdInForce(entries, 'ftp', date!) : thresholdInForce(entries, 'pace', date!);
            if (threshold === null) throw new ValidationError({ threshold: 'No threshold in force on this day.' });
            const durationS = samples.length;
            const np = w.sport === 'bike' ? normalisedPower(samples) : null;
            const ns = w.sport === 'run' ? normalisedSpeed(samples) : null;
            intensity = w.sport === 'bike' ? np! / threshold : ns! / (1000 / threshold);
            tss = w.sport === 'bike'
              ? (durationS * np! * intensity) / (threshold * 3600) * 100
              : (durationS / 3600) * intensity ** 2 * 100;
            npW = np;
            nsMps = ns;
            fileName = file.name;
            fileSize = bytes.length;
            fileSha = sha256Hex(bytes);
            fileType = contentTypeFor(isCsv);
          }
          await client.query(
            `INSERT INTO workouts (id, athlete_id, kind, sport, title, date, start_local, start_utc, duration_s,
              tss, if, np_w, ns_mps, source, version, file_name, file_size, file_sha256, file_content_type)
             VALUES ($1,$2,'completed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$15,$16,$17)
             ON CONFLICT (id) DO NOTHING`,
            [
              workoutIdByKey.get(w.key)!,
              athleteId,
              w.sport,
              w.title,
              date,
              w.start_local ?? null,
              null,
              duration,
              tss,
              intensity,
              npW,
              nsMps,
              w.file !== undefined ? 'file' : 'manual',
              fileName,
              fileSize,
              fileSha,
              fileType,
            ]
          );
        }
        ids[w.key] = workoutIdByKey.get(w.key)!;
        await this.recordKey(client, `workout:${w.key}`, ids[w.key]!);
      }
      // file objects must be stored after the workout rows exist; do it outside the transaction below.
      for (const c of parsed.comments) {
        const id = previous.get(`comment:${c.key}`) ?? randomUUID();
        ids[c.key] = id;
        await client.query(
          `INSERT INTO comments (id, workout_id, author_id, body) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO NOTHING`,
          [id, ids[c.workout]!, ids[c.author]!, c.body]
        );
        await this.recordKey(client, `comment:${c.key}`, id);
      }
      for (const p of parsed.plans) {
        const id = previous.get(`plan:${p.key}`) ?? randomUUID();
        ids[p.key] = id;
        await client.query(
          `INSERT INTO plans (id, owner_id, name, weeks, entries) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO NOTHING`,
          [id, ids[p.owner]!, p.name, p.weeks, JSON.stringify(p.entries)]
        );
        await this.recordKey(client, `plan:${p.key}`, id);
      }
      for (const l of parsed.links) {
        const id = previous.get(`link:${l.key}`) ?? randomUUID();
        ids[l.key] = id;
        const expiresAt = l.expires_at ?? new Date(Date.now() + this.deps.config.linkRequestTtlHours * 3600 * 1000).toISOString();
        await client.query(
          `INSERT INTO links (id, coach_id, athlete_id, status, expires_at) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO NOTHING`,
          [id, ids[l.coach]!, ids[l.athlete]!, l.status, l.status === 'requested' ? expiresAt : null]
        );
        await this.recordKey(client, `link:${l.key}`, id);
      }
      // events reference athletes only
      for (const u of parsed.users) {
        const token = await this.store.createOneTimeToken(client, ids[u.key]!);
        sign_in[u.key] = `/auth/one-time/${token}`;
      }
      // recompute series for every athlete, from the series start
      for (const u of parsed.users) {
        if (u.role === 'athlete') {
          const athleteId = ids[u.key]!;
          const athlete = await this.store.getUser(client, athleteId);
          const from = athlete.series_start ?? (await earliestWorkoutDate(client, athleteId)) ?? this.deps.today();
          await this.store.recomputeSeries(client, athleteId, from);
        }
      }
    });

    // store file objects after the transaction commits
    for (const w of parsed.workouts) {
      if (w.kind === 'completed' && w.file !== undefined) {
        const file = parsed.files.find((f) => f.key === w.file)!;
        const bytes = Buffer.from(file.content_base64, 'base64');
        const isCsv = file.name.toLowerCase().endsWith('.csv');
        const key = storageKeyFor(ids[w.athlete]!, ids[w.key]!, isCsv);
        try {
          await this.store.storage().put(
            { key, size: bytes.length, sha256: sha256Hex(bytes), contentType: contentTypeFor(isCsv), filename: file.name },
            bytes
          );
        } catch {
          // seeded files require storage; surface the failure
          throw new ValidationError({ file: 'Activity storage is unavailable.' });
        }
      }
    }

    if (parsed.today !== null) {
      this.deps.resetToday(parsed.today);
    }
    return { today: parsed.today ?? this.deps.today(), ids, sign_in };
  }

  /** Records a seed key to id mapping inside the current transaction. */
  private async recordKey(client: Queryable, key: string, id: string): Promise<void> {
    await client.query(
      `INSERT INTO seed_keys (key, entity_type, entity_id) VALUES ($1,'record',$2)
       ON CONFLICT (key) DO UPDATE SET entity_id = EXCLUDED.entity_id`,
      [key, id]
    );
  }

  /** The id a seed key resolved to in an earlier seed, if any. */
  private async seedKeyIds(): Promise<Map<string, string>> {
    const res = await this.pool.query(`SELECT key, entity_id FROM seed_keys`);
    const map = new Map<string, string>();
    for (const row of res.rows as { key: string; entity_id: string }[]) {
      map.set(row.key, row.entity_id);
    }
    return map;
  }

  private async upsertUser(
    client: Queryable,
    u: ParsedUser,
    previousId: string | undefined
  ): Promise<string> {
    const byKey = previousId !== undefined
      ? await client.query(`SELECT id FROM users WHERE id = $1`, [previousId])
      : null;
    if (byKey !== null && byKey.rows.length > 0) return previousId!;
    const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [u.email.toLowerCase()]);
    if (existing.rows.length > 0) return (existing.rows[0] as { id: string }).id;
    const id = previousId ?? randomUUID();
    const bcrypt = await import('bcryptjs');
    const hash = bcrypt.hashSync(u.password, 10);
    await client.query(
      `INSERT INTO users (id, role, name, email, password_hash, tz, coach_code, series_start, start_ctl, start_atl)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        u.role,
        u.name,
        u.email.toLowerCase(),
        hash,
        u.tz,
        u.coach_code ?? (u.role === 'coach' ? randomCode() : null),
        u.series_start ?? null,
        u.start_ctl ?? 0,
        u.start_atl ?? 0,
      ]
    );
    return id;
  }
}

async function earliestWorkoutDate(client: Queryable, athleteId: string): Promise<LocalDate | null> {
  const res = await client.query(
    `SELECT to_char(MIN(date),'YYYY-MM-DD') as d FROM workouts WHERE athlete_id = $1`,
    [athleteId]
  );
  const d = (res.rows[0] as { d: string | null }).d;
  return d;
}

function parseSeedStart(start: string, tz: string): { date: LocalDate } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(start);
  if (!m) throw new ValidationError({ file: 'The file is not valid activity JSON.' });
  const offsetMatch = /(Z|[+-]\d{2}:?\d{2})$/.exec(start);
  if (offsetMatch) {
    // convert to the athlete's zone using the same instant rules
    const epoch = Date.parse(start.includes('T') ? start : start.replace(' ', 'T')) / 1000;
    const dt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = dt.formatToParts(new Date(epoch * 1000));
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return { date: `${map.year}-${map.month}-${map.day}` };
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}` };
}


interface ParsedUser {
  key: string;
  role: 'athlete' | 'coach';
  name: string;
  email: string;
  password: string;
  tz: string;
  coach_code: string | null;
  series_start: LocalDate | null;
  start_ctl: number;
  start_atl: number;
  thresholds: { kind: 'ftp' | 'pace'; value: number; effective_from: LocalDate }[];
}

interface ParsedLink {
  key: string;
  coach: string;
  athlete: string;
  status: 'requested' | 'accepted' | 'declined' | 'removed';
  expires_at: string | null;
}

interface ParsedFile {
  key: string;
  name: string;
  content_base64: string;
}

interface ParsedLibrary {
  key: string;
  owner: string;
  name: string;
  sport: Sport;
  steps: Step[];
}

interface ParsedWorkout {
  key: string;
  athlete: string;
  kind: 'planned' | 'completed';
  date: LocalDate;
  start_local: string | null;
  sport: Sport;
  title: string;
  steps: Step[] | null;
  duration_s: number | null;
  source: 'builder' | 'library' | 'plan' | 'copy' | null;
  manual:
    | { kind: 'bike'; duration_s: number; avg_power_w: number }
    | { kind: 'run'; duration_s: number; avg_pace_s_per_km: number }
    | null;
  file: string | undefined;
}

interface ParsedComment {
  key: string;
  workout: string;
  author: string;
  body: string;
}

interface ParsedPlan {
  key: string;
  owner: string;
  name: string;
  weeks: number;
  entries: { day: number; start_local: string; sport: Sport; title: string; steps: Step[] | null; duration_s: number | null }[];
}

interface ParsedEvent {
  key: string;
  athlete: string;
  name: string;
  date: LocalDate;
}

interface ParsedSeed {
  today: LocalDate | null;
  users: ParsedUser[];
  links: ParsedLink[];
  files: ParsedFile[];
  library: ParsedLibrary[];
  workouts: ParsedWorkout[];
  comments: ParsedComment[];
  plans: ParsedPlan[];
  events: ParsedEvent[];
}

function fail(path: string, message: string): never {
  throw new ValidationError({ [path]: message });
}

function parseSeedBody(body: SeedBody): ParsedSeed {
  const errors: Record<string, string> = {};
  const err = (path: string, message: string): void => {
    if (!(path in errors)) errors[path] = message;
  };
  const todayRaw = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : null;
  const users: ParsedUser[] = [];
  const userRaw = Array.isArray(body.users) ? (body.users as Record<string, unknown>[]) : fail('users', 'Add at least one user.');
  for (let i = 0; i < userRaw.length; i++) {
    const raw = userRaw[i]!;
    const path = (n: string) => `users[${i}].${n}`;
    const key = typeof raw.key === 'string' ? raw.key : err(path('key'), 'Missing key.') as never;
    const role = raw.role === 'coach' || raw.role === 'athlete' ? raw.role : err(path('role'), 'Choose athlete or coach.') as never;
    const name = typeof raw.name === 'string' && raw.name.length >= 1 ? raw.name : err(path('name'), 'Enter a title of 1 to 80 characters.') as never;
    const email = typeof raw.email === 'string' && /^[^@\s]+@[^@\s]+$/.test(raw.email) ? raw.email : err(path('email'), 'Enter a valid email.') as never;
    const password = typeof raw.password === 'string' && raw.password.length >= 1 ? raw.password : err(path('password'), 'Enter a password.') as never;
    const tz = typeof raw.tz === 'string' ? raw.tz : 'UTC';
    const coach_code = typeof raw.coach_code === 'string' && /^[A-Z0-9]{6}$/.test(raw.coach_code) ? raw.coach_code : null;
    const series_start = typeof raw.series_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.series_start) ? raw.series_start : null;
    const start_ctl = typeof raw.start_ctl === 'number' ? raw.start_ctl : 0;
    const start_atl = typeof raw.start_atl === 'number' ? raw.start_atl : 0;
    const thresholds: ParsedUser['thresholds'] = [];
    if (Array.isArray(raw.thresholds)) {
      const tr = raw.thresholds as Record<string, unknown>[];
      for (let j = 0; j < tr.length; j++) {
        const t = tr[j]!;
        const kind = t.kind === 'ftp' || t.kind === 'pace' ? t.kind : err(`users[${i}].thresholds[${j}].kind`, 'Choose ftp or pace.') as never;
        const value = typeof t.value === 'number' ? t.value : err(`users[${i}].thresholds[${j}].value`, 'Enter a value.') as never;
        const eff = typeof t.effective_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.effective_from) ? t.effective_from : err(`users[${i}].thresholds[${j}].effective_from`, 'Enter a date as YYYY-MM-DD.') as never;
        thresholds.push({ kind, value, effective_from: eff });
      }
    }
    users.push({ key, role, name, email, password, tz, coach_code, series_start, start_ctl, start_atl, thresholds });
  }
  const links: ParsedLink[] = [];
  if (Array.isArray(body.links)) {
    (body.links as Record<string, unknown>[]).forEach((raw, i) => {
      const status = raw.status === 'requested' || raw.status === 'accepted' || raw.status === 'declined' || raw.status === 'removed'
        ? raw.status
        : err(`links[${i}].status`, 'Choose a status.') as never;
      links.push({
        key: String(raw.key ?? ''),
        coach: String(raw.coach ?? ''),
        athlete: String(raw.athlete ?? ''),
        status,
        expires_at: typeof raw.expires_at === 'string' ? raw.expires_at : null,
      });
    });
  }
  const files: ParsedFile[] = [];
  if (Array.isArray(body.files)) {
    (body.files as Record<string, unknown>[]).forEach((raw, i) => {
      files.push({
        key: String(raw.key ?? ''),
        name: typeof raw.name === 'string' ? raw.name : err(`files[${i}].name`, 'Enter a file name.') as never,
        content_base64: typeof raw.content_base64 === 'string' ? raw.content_base64 : err(`files[${i}].content_base64`, 'Enter base64 content.') as never,
      });
    });
  }
  const library: ParsedLibrary[] = [];
  if (Array.isArray(body.library)) {
    (body.library as Record<string, unknown>[]).forEach((raw, i) => {
      const steps = parseSeedSteps(raw.steps, `library[${i}].steps`, err);
      library.push({
        key: String(raw.key ?? ''),
        owner: String(raw.owner ?? ''),
        name: typeof raw.name === 'string' ? raw.name : err(`library[${i}].name`, 'Enter a title of 1 to 80 characters.') as never,
        sport: raw.sport === 'bike' || raw.sport === 'run' ? raw.sport : err(`library[${i}].sport`, 'Choose bike or run.') as never,
        steps,
      });
    });
  }
  const workouts: ParsedWorkout[] = [];
  if (Array.isArray(body.workouts)) {
    (body.workouts as Record<string, unknown>[]).forEach((raw, i) => {
      const path = (n: string) => `workouts[${i}].${n}`;
      const kind = raw.kind === 'planned' || raw.kind === 'completed' ? raw.kind : err(path('kind'), 'Choose planned or completed.') as never;
      const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
      const sport = raw.sport === 'bike' || raw.sport === 'run' ? raw.sport : err(path('sport'), 'Choose bike or run.') as never;
      const title = typeof raw.title === 'string' && raw.title.length >= 1 ? raw.title : err(path('title'), 'Enter a title of 1 to 80 characters.') as never;
      const start_local = typeof raw.start_local === 'string' && /^\d{2}:\d{2}$/.test(raw.start_local) ? raw.start_local : null;
      let steps: Step[] | null = null;
      let duration_s: number | null = null;
      if (raw.steps !== undefined) steps = parseSeedSteps(raw.steps, path('steps'), err);
      if (raw.duration_s !== undefined && typeof raw.duration_s === 'number') duration_s = raw.duration_s;
      let manual: ParsedWorkout['manual'] = null;
      if (raw.manual !== undefined && typeof raw.manual === 'object' && raw.manual !== null) {
        const m = raw.manual as Record<string, unknown>;
        const duration = typeof m.duration_s === 'number' ? m.duration_s : err(path('manual.duration_s'), 'Enter a duration from 0:01:00 to 24:00:00.') as never;
        if (typeof m.avg_power_w === 'number') {
          manual = { kind: 'bike', duration_s: duration, avg_power_w: m.avg_power_w };
        } else if (typeof m.avg_pace_s_per_km === 'number') {
          manual = { kind: 'run', duration_s: duration, avg_pace_s_per_km: m.avg_pace_s_per_km };
        } else {
          err(path('manual.avg_power_w'), 'Enter an average power from 1 to 2000 W.');
        }
      }
      workouts.push({
        key: String(raw.key ?? ''),
        athlete: String(raw.athlete ?? ''),
        kind,
        date: date ?? '',
        start_local,
        sport,
        title,
        steps,
        duration_s,
        source: null,
        manual,
        file: typeof raw.file === 'string' ? raw.file : undefined,
      });
    });
  }
  const comments: ParsedComment[] = [];
  if (Array.isArray(body.comments)) {
    (body.comments as Record<string, unknown>[]).forEach((raw, i) => {
      comments.push({
        key: String(raw.key ?? ''),
        workout: String(raw.workout ?? ''),
        author: String(raw.author ?? ''),
        body: typeof raw.body === 'string' ? raw.body : err(`comments[${i}].body`, 'Write a comment of 1 to 1000 characters.') as never,
      });
    });
  }
  const plans: ParsedPlan[] = [];
  if (Array.isArray(body.plans)) {
    (body.plans as Record<string, unknown>[]).forEach((raw, i) => {
      const entries: ParsedPlan['entries'] = [];
      if (Array.isArray(raw.entries)) {
        (raw.entries as Record<string, unknown>[]).forEach((e, j) => {
          const steps = e.steps !== undefined ? parseSeedSteps(e.steps, `plans[${i}].entries[${j}].steps`, err) : null;
          entries.push({
            day: typeof e.day === 'number' ? e.day : err(`plans[${i}].entries[${j}].day`, 'Enter a day.') as never,
            start_local: typeof e.start_local === 'string' ? e.start_local : err(`plans[${i}].entries[${j}].start_local`, 'Enter a time as HH:MM.') as never,
            sport: e.sport === 'bike' || e.sport === 'run' ? e.sport : err(`plans[${i}].entries[${j}].sport`, 'Choose bike or run.') as never,
            title: typeof e.title === 'string' ? e.title : err(`plans[${i}].entries[${j}].title`, 'Enter a title.') as never,
            steps,
            duration_s: typeof e.duration_s === 'number' ? e.duration_s : null,
          });
        });
      }
      plans.push({
        key: String(raw.key ?? ''),
        owner: String(raw.owner ?? ''),
        name: typeof raw.name === 'string' ? raw.name : err(`plans[${i}].name`, 'Enter a title of 1 to 80 characters.') as never,
        weeks: typeof raw.weeks === 'number' ? raw.weeks : err(`plans[${i}].weeks`, 'A plan runs 1 to 24 weeks.') as never,
        entries,
      });
    });
  }
  const events: ParsedEvent[] = [];
  if (Array.isArray(body.events)) {
    (body.events as Record<string, unknown>[]).forEach((raw, i) => {
      events.push({
        key: String(raw.key ?? `event${i}`),
        athlete: String(raw.athlete ?? ''),
        name: typeof raw.name === 'string' ? raw.name : err(`events[${i}].name`, 'Enter an event name of 1 to 60 characters.') as never,
        date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : err(`events[${i}].date`, 'Enter a date as YYYY-MM-DD.') as never,
      });
    });
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { today: todayRaw, users, links, files, library, workouts, comments, plans, events };
}

function parseSeedSteps(value: unknown, path: string, err: (p: string, m: string) => void): Step[] {
  if (!Array.isArray(value) || value.length === 0) {
    err(path, 'Add at least one step.');
    return [];
  }
  const out: Step[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) {
      err(path, 'Add at least one step.');
      return out;
    }
    const r = raw as Record<string, unknown>;
    if (r.kind === 'interval') {
      const work = r.work as { duration_s?: unknown; target_pct?: unknown } | undefined;
      const recovery = r.recovery as { duration_s?: unknown; target_pct?: unknown } | undefined;
      out.push({
        kind: 'interval',
        repeat: typeof r.repeat === 'number' ? r.repeat : 1,
        work: {
          duration_s: typeof work?.duration_s === 'number' ? work.duration_s : 180,
          target_pct: typeof work?.target_pct === 'number' ? work.target_pct : 100,
        },
        recovery: {
          duration_s: typeof recovery?.duration_s === 'number' ? recovery.duration_s : 180,
          target_pct: typeof recovery?.target_pct === 'number' ? recovery.target_pct : 50,
        },
      });
    } else if (r.kind === 'warmup' || r.kind === 'steady' || r.kind === 'recovery' || r.kind === 'cooldown') {
      out.push({
        kind: r.kind,
        duration_s: typeof r.duration_s === 'number' ? r.duration_s : 600,
        target_pct: typeof r.target_pct === 'number' ? r.target_pct : 60,
      });
    }
  }
  return out;
}

function demoBody(): SeedBody {
  const steady = (durationS: number, pct: number) => [{ kind: 'steady', duration_s: durationS, target_pct: pct }];
  const fives = [
    { kind: 'warmup', duration_s: 600, target_pct: 60 },
    { kind: 'interval', repeat: 5, work: { duration_s: 240, target_pct: 110 }, recovery: { duration_s: 180, target_pct: 55 } },
    { kind: 'cooldown', duration_s: 600, target_pct: 50 },
  ];
  const planEntries: unknown[] = [];
  for (let w = 1; w <= 12; w++) {
    planEntries.push({ day: 7 * (w - 1) + 2, start_local: '06:30', sport: 'bike', title: 'Fives at 110', steps: fives });
    planEntries.push({ day: 7 * (w - 1) + 4, start_local: '06:30', sport: 'run', title: 'Easy 45', steps: steady(2700, 75) });
    planEntries.push({ day: 7 * (w - 1) + 6, start_local: '07:00', sport: 'bike', title: 'Long ride', steps: steady(7200, 70) });
  }
  return {
    users: [
      { key: 'c1', role: 'coach', name: 'Mara Quill', email: 'mara@ottermere.test', password: 'tempoline-demo', tz: 'Europe/London', coach_code: 'MQ7K2P' },
      { key: 'c2', role: 'coach', name: 'Idris Fenn', email: 'idris@ottermere.test', password: 'tempoline-demo', tz: 'Europe/Berlin', coach_code: 'IF4R9T' },
      {
        key: 'a1', role: 'athlete', name: 'Tavi Rennick', email: 'tavi@ottermere.test', password: 'tempoline-demo', tz: 'Pacific/Auckland',
        series_start: '2026-09-01', start_ctl: 0, start_atl: 0,
        thresholds: [
          { kind: 'ftp', value: 250, effective_from: '2026-09-01' },
          { kind: 'pace', value: 300, effective_from: '2026-09-01' },
        ],
      },
      {
        key: 'a2', role: 'athlete', name: 'Noor Halvorsen', email: 'noor@ottermere.test', password: 'tempoline-demo', tz: 'Europe/London',
        thresholds: [
          { kind: 'ftp', value: 210, effective_from: '2026-09-01' },
          { kind: 'pace', value: 330, effective_from: '2026-09-01' },
        ],
      },
      {
        key: 'a3', role: 'athlete', name: 'Ezra Blom', email: 'ezra@ottermere.test', password: 'tempoline-demo', tz: 'Europe/Berlin',
        thresholds: [
          { kind: 'ftp', value: 280, effective_from: '2026-09-01' },
          { kind: 'pace', value: 285, effective_from: '2026-09-01' },
        ],
      },
    ],
    links: [
      { key: 'l1', coach: 'c1', athlete: 'a1', status: 'accepted' },
      { key: 'l2', coach: 'c1', athlete: 'a2', status: 'accepted' },
      { key: 'l3', coach: 'c1', athlete: 'a3', status: 'requested' },
    ],
    files: [],
    library: [{ key: 'lib1', owner: 'a1', name: 'Fives at 110', sport: 'bike', steps: fives }],
    workouts: [
      { key: 'w1', athlete: 'a1', kind: 'planned', date: '2026-11-02', start_local: '06:30', sport: 'bike', title: 'Endurance hour', steps: steady(3600, 80) },
      { key: 'w2', athlete: 'a1', kind: 'completed', date: '2026-11-02', sport: 'bike', title: 'Endurance hour', manual: { duration_s: 3600, avg_power_w: 200 } },
      { key: 'w4', athlete: 'a1', kind: 'planned', date: '2026-11-03', start_local: '06:30', sport: 'run', title: 'Easy 45', steps: steady(2700, 75) },
      { key: 'w5', athlete: 'a1', kind: 'completed', date: '2026-11-04', sport: 'run', title: 'Lunch run', manual: { duration_s: 2700, avg_pace_s_per_km: 330 } },
      { key: 'w6', athlete: 'a1', kind: 'planned', date: '2026-11-05', start_local: '06:30', sport: 'bike', title: 'Fives at 110', steps: fives },
      { key: 'w7', athlete: 'a1', kind: 'planned', date: '2026-11-07', start_local: '07:00', sport: 'bike', title: 'Long ride', steps: steady(10800, 70) },
      { key: 'w8', athlete: 'a2', kind: 'planned', date: '2026-11-02', start_local: '06:30', sport: 'bike', title: 'Tempo ride', steps: steady(2400, 88) },
    ],
    comments: [{ key: 'm1', workout: 'w2', author: 'c1', body: 'Steady and even.' }],
    plans: [{ key: 'p1', owner: 'c1', name: 'Twelve to race day', weeks: 12, entries: planEntries }],
    events: [{ key: 'e1', athlete: 'a1', name: 'Harbour Half', date: '2026-12-20' }],
  };
}

