import express, { type Request, type Response } from 'express';
import { withTransaction } from './db.js';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';
import type { LocalDate, IsoWeek } from './dates.js';
import { addDays, daysBetween, isIsoWeek, isLocalDate, isoWeekOf, mondayFromWeek, mondayOf } from './dates.js';
import { emptyTally, plannedIf, stepsDuration, stepsPlannedTss, type Step, type Tally } from './domain.js';
import { conflict, CONFLICT_MESSAGES, notFound, unauthenticated, ValidationError } from './errors.js';
import { sendError, sessionCookie } from './http.js';
import type { Store } from './store.js';
import type { ItemJson, PlanEntry, SeriesRow, UserRow, WorkoutRow, LiveChangeEvent } from './types.js';
import { workoutToJson } from './types.js';
import { MESSAGES, FieldErrors, parseDate, parseFtp, parsePace, parseSteps, parseSport, parseTitle } from './validation.js';
import { WorkoutService } from './workouts.js';
import { parseMultipart } from './multipart.js';

export interface ApiContext {
  store: Store;
  config: AppConfig;
  today: () => LocalDate;
  liveHub: LiveHub;
}

export interface LiveHub {
  broadcast(event: LiveChangeEvent): void;
  notifyUser(userId: string, text: string): void;
}

export function buildApiRouter(ctx: ApiContext): express.Router {
  const router = express.Router();
  const { store, liveHub } = ctx;
  const today = ctx.today;
  const jsonLimit = 1000000;

  router.use(express.json({ limit: jsonLimit, type: 'application/json' }));

  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => {
    return (req: Request, res: Response) => {
      fn(req, res).catch((err: unknown) => sendError(res, err));
    };
  };

  // ------------------------------------------------------------------ helpers

  const requireAuth = (req: Request): UserRow => {
    const user = (req as Request & { user?: UserRow }).user;
    if (!user) throw unauthenticated();
    return user;
  };

  const me = (user: UserRow) => ({
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    tz: user.tz,
    coach_code: user.coach_code,
    today: today(),
  });

  const viewAthlete = async (req: Request, id: string): Promise<UserRow> => {
    const user = requireAuth(req);
    return store.canViewAthlete(store.db, user.id, id);
  };

  const weekTotals = (items: ItemJson[]): { planned: number; completed: number; tally: Tally } => {
    const tally = emptyTally();
    let planned = 0;
    let completed = 0;
    for (const item of items) {
      if (item.planned) {
        planned += item.planned.planned_tss ?? 0;
      }
      if (item.completed) {
        completed += item.completed.tss ?? 0;
      }
      tally[item.compliance] += 1;
    }
    return { planned, completed, tally };
  };

  const sportsTotals = (items: ItemJson[]) => {
    let bikeTss = 0;
    let runTss = 0;
    let bikeS = 0;
    let runS = 0;
    let sessions = 0;
    for (const item of items) {
      const c = item.completed;
      if (!c) continue;
      sessions += 1;
      if (c.sport === 'bike') {
        bikeTss += c.tss ?? 0;
        bikeS += c.duration_s;
      } else {
        runTss += c.tss ?? 0;
        runS += c.duration_s;
      }
    }
    return { bike_tss: bikeTss, run_tss: runTss, bike_s: bikeS, run_s: runS, sessions };
  };

  const tsbOfWeek = (series: readonly SeriesRow[], monday: LocalDate): number | null => {
    const target = monday < today() ? addDays(monday, 6) : today();
    const row = series.find((s) => s.date === target) ?? series.find((s) => s.date === today());
    return row ? row.tsb : null;
  };

  const weeksPayload = async (athlete: UserRow, week: IsoWeek, before: number, after: number) => {
    const baseMonday = mondayFromWeek(week);
    const weekSeries = await store.fullSeries(store.db, athlete.id);
    const weeks = [];
    for (let offset = -before; offset <= after; offset++) {
      const monday = addDays(baseMonday, offset * 7);
      const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
      const items = await store.weekItems(store.db, athlete.id, days);
      const all = days.flatMap((d) => items.get(d) ?? []);
      const totals = weekTotals(all);
      weeks.push({
        week: isoWeekOf(days[0]!),
        monday,
        planned_tss: totals.planned,
        completed_tss: totals.completed,
        tsb: tsbOfWeek(weekSeries, monday),
        tally: totals.tally,
        sports: sportsTotals(all),
        days: days.map((date) => ({ date, items: items.get(date) ?? [] })),
      });
    }
    return { today: today(), weeks };
  };

  const recentUploads = async (athlete: UserRow) => {
    const rows = await store.recentCompleted(store.db, athlete.id, 10);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      tss: r.tss,
      sport: r.sport,
      created_at: r.created_at.toISOString(),
    }));
  };

  const nextEvent = async (athlete: UserRow) => {
    const evs = await store.events(store.db, athlete.id);
    return evs.find((e) => e.date >= today()) ?? null;
  };

  // ------------------------------------------------------------------ auth

  router.post('/auth/sign-in', wrap(async (req, res) => {
    const body = req.body as { email?: unknown; password?: unknown };
    const errors = new FieldErrors();
    if (typeof body?.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) errors.add('email', 'Enter your email address.');
    if (typeof body?.password !== 'string' || body.password.length === 0) errors.add('password', 'Enter your password.');
    errors.throwIfAny();
    const user = await store.findByEmail(store.db, body.email as string);
    const ok = user ? await bcryptVerify(store.db, body.password as string, user.id) : false;
    if (!user || !ok) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Email or password is incorrect.' });
      return;
    }
    const token = await withTransaction(async (client) => store.createSession(client, user.id));
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.json({ user: me(user) });
  }));

  router.post('/auth/sign-out', wrap(async (req, res) => {
    const token = (req as Request & { sessionToken?: string }).sessionToken;
    if (token) await store.deleteSession(store.db, token);
    res.setHeader('Set-Cookie', sessionCookie('', true));
    res.status(204).end();
  }));

  router.get('/me', wrap(async (req, res) => {
    const user = requireAuth(req);
    res.json(me(user));
  }));

  // ------------------------------------------------------------------ athletes

  router.get('/athletes', wrap(async (req, res) => {
    const user = requireAuth(req);
    const athletes = user.role === 'coach' ? await store.linkedAthletes(store.db, user.id) : [user];
    const out = [];
    for (const a of athletes) {
      const monday = mondayOf(today());
      const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
      const items = await store.weekItems(store.db, a.id, days);
      const all = days.flatMap((d) => items.get(d) ?? []);
      const totals = weekTotals(all);
      const latest = await store.latestItem(store.db, a.id);
      out.push({
        id: a.id,
        name: a.name,
        tz: a.tz,
        week: { week: isoWeekOf(monday), planned_tss: totals.planned, completed_tss: totals.completed },
        latest,
      });
    }
    res.json({ athletes: out });
  }));

  router.get('/athletes/:id', wrap(async (req, res) => {
    const athlete = await viewAthlete(req, req.params.id!);
    const thresholds = await store.thresholds(store.db, athlete.id);
    const events = await store.events(store.db, athlete.id);
    res.json({
      id: athlete.id,
      name: athlete.name,
      tz: athlete.tz,
      series_start: athlete.series_start,
      thresholds: thresholds.map((t) => ({ kind: t.kind, value: t.value, effective_from: t.effective_from })),
      events: events.map((e) => ({ name: e.name, date: e.date })),
    });
  }));

  router.post('/athletes/:id/thresholds', wrap(async (req, res) => {
    const athlete = await viewAthlete(req, req.params.id!);
    const body = req.body as { kind?: unknown; value?: unknown; effective_from?: unknown };
    const errors = new FieldErrors();
    if (body?.kind !== 'ftp' && body?.kind !== 'pace') errors.add('kind', 'Choose FTP or threshold pace.');
    const effectiveFrom = parseDate(body?.effective_from, 'effective_from', errors);
    const value = body?.kind === 'pace' ? parsePace(body?.value, errors) : parseFtp(body?.value, errors);
    errors.throwIfAny();
    if (athlete.series_start && effectiveFrom! < athlete.series_start) {
      throw new ValidationError({ effective_from: MESSAGES.dateBeforeStart });
    }
    const result = await withTransaction(async (client) => {
      const r = await store.addThreshold(client, athlete.id, body.kind as 'ftp' | 'pace', value!, effectiveFrom!);
      await store.recomputeSeries(client, athlete.id, effectiveFrom!);
      return r;
    });
    liveHub.broadcast({ athlete_id: athlete.id, what: 'thresholds' });
    liveHub.broadcast({ athlete_id: athlete.id, what: 'series' });
    res.status(result.replaced ? 200 : 201).json({
      threshold: { kind: result.threshold.kind, value: result.threshold.value, effective_from: result.threshold.effective_from },
      rescored: result.rescored,
      series_from: effectiveFrom,
    });
  }));

  router.get('/athletes/:id/weeks', wrap(async (req, res) => {
    const athlete = await viewAthlete(req, req.params.id!);
    const errors = new FieldErrors();
    const weekParam = typeof req.query.week === 'string' ? req.query.week : null;
    let week: IsoWeek;
    if (weekParam === null) {
      week = isoWeekOf(today());
    } else if (!isIsoWeek(weekParam)) {
      errors.add('week', MESSAGES.week);
      errors.throwIfAny();
      return;
    } else {
      week = weekParam;
    }
    const before = clampInt(req.query.before, 0, 12, 4);
    const after = clampInt(req.query.after, 0, 12, 4);
    res.json(await weeksPayload(athlete, week, before, after));
  }));

  router.get('/athletes/:id/series', wrap(async (req, res) => {
    const athlete = await viewAthlete(req, req.params.id!);
    const from = typeof req.query.from === 'string' && isLocalDate(req.query.from) ? req.query.from : athlete.series_start;
    const to = typeof req.query.to === 'string' && isLocalDate(req.query.to) ? req.query.to : today();
    const series = athlete.series_start
      ? await store.seriesRange(store.db, athlete.id, from ?? athlete.series_start, to)
      : [];
    res.json({ days: series.map((s) => ({ date: s.date, tss: s.tss, ctl: s.ctl, atl: s.atl, tsb: s.tsb })) });
  }));

  router.get('/athletes/:id/home', wrap(async (req, res) => {
    const athlete = await viewAthlete(req, req.params.id!);
    const weekParam = typeof req.query.week === 'string' && isIsoWeek(req.query.week) ? req.query.week : isoWeekOf(today());
    const before = clampInt(req.query.before, 0, 12, 4);
    const after = clampInt(req.query.after, 0, 12, 4);
    const weeks = await weeksPayload(athlete, weekParam, before, after);
    const series = athlete.series_start
      ? await store.seriesRange(store.db, athlete.id, athlete.series_start, today())
      : [];
    const recent = await recentUploads(athlete);
    const event = await nextEvent(athlete);
    const thresholds = await store.thresholds(store.db, athlete.id);
    const banner = series.find((s) => s.date === today()) ?? series[series.length - 1] ?? null;
    const rings = await complianceRings(athlete, weekParam);
    res.json({
      today: today(),
      me: { id: athlete.id, name: athlete.name, tz: athlete.tz, role: 'athlete', series_start: athlete.series_start },
      weeks: weeks.weeks,
      series,
      recent,
      event,
      banner,
      rings,
      thresholds: thresholds.map((t) => ({ kind: t.kind, value: t.value, effective_from: t.effective_from })),
    });
  }));

  const complianceRings = async (athlete: UserRow, week: IsoWeek) => {
    const monday = mondayFromWeek(week);
    const out = [];
    for (const span of [1, 4, 12]) {
      const end = addDays(monday, 6);
      const start = addDays(end, -span * 7 + 1);
      const days = [];
      for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
      const items = await store.weekItems(store.db, athlete.id, days);
      const all = days.flatMap((d) => items.get(d) ?? []);
      let paired = 0;
      let onTarget = 0;
      let missed = 0;
      for (const item of all) {
        if (item.completed && item.planned) { paired++; if (item.compliance === 'on-target') onTarget++; }
        else if (item.planned && item.compliance === 'missed') missed++;
      }
      const denom = paired + missed;
      out.push({
        span,
        percent: denom === 0 ? null : Math.round((onTarget / denom) * 100),
      });
    }
    return out;
  };

  // ------------------------------------------------------------------ workouts

  const workoutService = new WorkoutService({
    store,
    config: { activityMaxBytes: ctx.config.activityMaxBytes, activityMaxSamples: ctx.config.activityMaxSamples },
    today,
    liveHub,
  });

  router.post('/athletes/:id/workouts', wrap(async (req, res) => {
    const user = requireAuth(req);
    const athlete = await store.canViewAthlete(store.db, user.id, req.params.id!);
    await workoutService.createPlanned(req, res, athlete);
  }));

  router.get('/workouts/:id', wrap(async (req, res) => {
    const user = requireAuth(req);
    const workout = await store.getWorkout(store.db, req.params.id!);
    await store.canViewAthlete(store.db, user.id, workout.athlete_id);
    const item = await workoutService.itemFor(workout);
    const comments = await store.comments(store.db, workout.id);
    res.json({ workout: workoutToJson(workout), item, comments });
  }));

  router.patch('/workouts/:id', wrap(async (req, res) => {
    const user = requireAuth(req);
    const workout = await store.getWorkout(store.db, req.params.id!);
    await store.canViewAthlete(store.db, user.id, workout.athlete_id);
    await workoutService.patch(req, res, workout);
  }));

  router.delete('/workouts/:id', wrap(async (req, res) => {
    const user = requireAuth(req);
    const workout = await store.getWorkout(store.db, req.params.id!);
    await store.canViewAthlete(store.db, user.id, workout.athlete_id);
    await workoutService.remove(res, workout);
  }));

  router.get('/workouts/:id/original', wrap(async (req, res) => {
    const user = requireAuth(req);
    const workout = await store.getWorkout(store.db, req.params.id!);
    await store.canViewAthlete(store.db, user.id, workout.athlete_id);
    await workoutService.original(res, workout);
  }));

  router.post('/athletes/:id/manual', wrap(async (req, res) => {
    const user = requireAuth(req);
    const athlete = await store.canViewAthlete(store.db, user.id, req.params.id!);
    await workoutService.manual(req, res, athlete);
  }));

  router.post('/athletes/:id/uploads', wrap(async (req, res) => {
    const user = requireAuth(req);
    // Read the body before awaiting anything, so no stream data is lost.
    const upload = parseMultipart(req);
    const athlete = await store.canViewAthlete(store.db, user.id, req.params.id!);
    const parsed = await upload;
    await workoutService.upload(res, athlete, parsed);
  }));

  router.get('/workouts/:id/comments', wrap(async (req, res) => {
    const user = requireAuth(req);
    const workout = await store.getWorkout(store.db, req.params.id!);
    await store.canViewAthlete(store.db, user.id, workout.athlete_id);
    res.json({ comments: await store.comments(store.db, workout.id) });
  }));

  router.post('/workouts/:id/comments', wrap(async (req, res) => {
    const user = requireAuth(req);
    const workout = await store.getWorkout(store.db, req.params.id!);
    const athlete = await store.canViewAthlete(store.db, user.id, workout.athlete_id);
    const body = (req.body ?? {}) as { body?: unknown };
    if (typeof body.body !== 'string' || body.body.length < 1 || body.body.length > 1000) {
      throw new ValidationError({ body: MESSAGES.body });
    }
    const id = await insertComment(workout.id, user.id, body.body);
    const comment = (await store.comments(store.db, workout.id)).find((c) => c.id === id)!;
    liveHub.broadcast({ athlete_id: athlete.id, what: 'comments', workout_id: workout.id });
    notifyOtherParty(user, athlete.id, `${user.name} commented on ${workout.title}.`);
    res.status(201).json({ comment });
  }));

  function notifyOtherParty(author: UserRow, athleteId: string, text: string): void {
    if (author.id === athleteId) {
      void notifyLinkedCoaches(athleteId, text);
    } else {
      liveHub.notifyUser(athleteId, text);
    }
  }

  async function notifyLinkedCoaches(athleteId: string, text: string): Promise<void> {
    const coaches = await store.db.query(`SELECT coach_id FROM links WHERE athlete_id = $1 AND status = 'accepted'`, [athleteId]);
    for (const row of coaches.rows as { coach_id: string }[]) liveHub.notifyUser(row.coach_id, text);
  }

  async function insertComment(workoutId: string, authorId: string, body: string): Promise<string> {
    const id = randomUUID();
    await store.db.query(`INSERT INTO comments (id, workout_id, author_id, body) VALUES ($1,$2,$3,$4)`, [id, workoutId, authorId, body]);
    return id;
  }

  // ------------------------------------------------------------------ library

  router.get('/library', wrap(async (req, res) => {
    const user = requireAuth(req);
    const rows = await store.db.query(
      `SELECT id, owner_id, name, sport, steps, duration_s, planned_tss, planned_if FROM library_items WHERE owner_id = $1 ORDER BY created_at`,
      [user.id]
    );
    res.json({
      library: rows.rows.map((r) => ({
        id: r.id,
        name: r.name,
        sport: r.sport,
        steps: r.steps,
        duration_s: r.duration_s,
        planned_tss: r.planned_tss,
        planned_if: r.planned_if,
      })),
    });
  }));

  router.post('/library', wrap(async (req, res) => {
    const user = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const errors = new FieldErrors();
    const name = parseTitle(body.name, 'name', errors);
    const sport = parseSport(body.sport, errors);
    const steps = parseSteps(body.steps, errors, 'steps');
    errors.throwIfAny();
    const built = steps!;
    const durationS = stepsDuration(built);
    const plannedTss = stepsPlannedTss(built);
    const plannedIfVal = plannedIf(built);
    const id = randomUUID();
    await store.db.query(
      `INSERT INTO library_items (id, owner_id, name, sport, steps, duration_s, planned_tss, planned_if)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, user.id, name, sport, JSON.stringify(built), durationS, plannedTss, plannedIfVal]
    );
    res.status(201).json({
      item: {
        id,
        name,
        sport,
        steps: built,
        duration_s: durationS,
        planned_tss: plannedTss,
        planned_if: plannedIfVal,
      },
    });
  }));

  router.delete('/library/:id', wrap(async (req, res) => {
    const user = requireAuth(req);
    const row = await store.db.query(`SELECT owner_id FROM library_items WHERE id = $1`, [req.params.id!]);
    if (row.rows.length === 0 || (row.rows[0] as { owner_id: string }).owner_id !== user.id) throw notFound();
    await store.db.query(`DELETE FROM library_items WHERE id = $1`, [req.params.id!]);
    res.status(204).end();
  }));

  // ------------------------------------------------------------------ plans

  router.get('/plans', wrap(async (req, res) => {
    const user = requireAuth(req);
    if (user.role !== 'coach') throw notFound();
    const rows = await store.db.query(
      `SELECT id, name, weeks, entries FROM plans WHERE owner_id = $1 ORDER BY created_at`,
      [user.id]
    );
    res.json({ plans: rows.rows.map((r) => ({ id: r.id, name: r.name, weeks: r.weeks, entries: r.entries })) });
  }));

  router.post('/plans', wrap(async (req, res) => {
    const user = requireAuth(req);
    if (user.role !== 'coach') throw notFound();
    const body = req.body as Record<string, unknown>;
    const errors = new FieldErrors();
    const name = parseTitle(body.name, 'name', errors);
    const weeks = parsePlanWeeks(body.weeks, errors);
    const entries = parsePlanEntries(body.entries, weeks, errors);
    errors.throwIfAny();
    const id = randomUUID();
    await store.db.query(
      `INSERT INTO plans (id, owner_id, name, weeks, entries) VALUES ($1,$2,$3,$4,$5)`,
      [id, user.id, name, weeks, JSON.stringify(entries)]
    );
    res.status(201).json({ plan: { id, name, weeks, entries } });
  }));

  router.post('/plans/:id/apply', wrap(async (req, res) => {
    const user = requireAuth(req);
    if (user.role !== 'coach') throw notFound();
    const planRow = await store.db.query(`SELECT id, owner_id, name, weeks, entries FROM plans WHERE id = $1`, [req.params.id!]);
    if (planRow.rows.length === 0 || (planRow.rows[0] as { owner_id: string }).owner_id !== user.id) throw notFound();
    const plan = planRow.rows[0] as { id: string; name: string; weeks: number; entries: PlanEntry[] };
    const athlete = await store.canViewAthlete(store.db, user.id, String((req.body as Record<string, unknown>).athlete_id ?? ''));
    const body = req.body as Record<string, unknown>;
    const errors = new FieldErrors();
    const mode = body.mode === 'event' ? 'event' : body.mode === 'start' ? 'start' : null;
    if (!mode) errors.add('mode', MESSAGES.mode);
    const date = parseDate(body.date, 'date', errors);
    let eventName: string | null = null;
    if (mode === 'event') {
      eventName = typeof body.event_name === 'string' && body.event_name.length >= 1 && body.event_name.length <= 60 ? body.event_name : null;
      if (!eventName) errors.add('event_name', MESSAGES.eventName);
    }
    errors.throwIfAny();

    const result = await applyPlan(athlete, plan, mode!, date!, eventName);
    res.status(201).json(result);
  }));

  const applyPlan = async (athlete: UserRow, plan: { weeks: number; entries: PlanEntry[] }, mode: 'start' | 'event', date: LocalDate, eventName: string | null) => {
    const totalDays = plan.weeks * 7;
    const firstDay = mode === 'start' ? date : addDays(date, -(totalDays - 1));
    const todayDate = today();
    const created: unknown[] = [];
    let skipped = 0;
    const keptDays = new Set<string>();
    const workouts: WorkoutRow[] = [];

    await withTransaction(async (client) => {
      for (const entry of plan.entries) {
        const dayIndex = entry.day - 1;
        const dayDate = addDays(firstDay, dayIndex);
        if (dayDate < todayDate) {
          skipped += 1;
          continue;
        }
        const steps = entry.steps ? scaleRestWeek(entry.steps, weekNumberOf(entry.day, plan.weeks)) : null;
        const durationS = steps
          ? stepsDuration(steps)
          : entry.duration_s
            ? scaleDuration(entry.duration_s, weekNumberOf(entry.day, plan.weeks))
            : 3600;
        const plannedTss = steps ? stepsPlannedTss(steps) : null;
        const plannedIfVal = steps ? plannedIf(steps) : null;
        const existing = await client.query(
          `SELECT 1 FROM workouts WHERE athlete_id = $1 AND date = $2`,
          [athlete.id, dayDate]
        );
        if (existing.rows.length > 0) keptDays.add(dayDate);
        const w = await store.insertWorkout(client, {
          athlete_id: athlete.id,
          kind: 'planned',
          sport: entry.sport,
          title: entry.title,
          date: dayDate,
          start_local: entry.start_local,
          duration_s: durationS,
          steps,
          planned_tss: plannedTss,
          planned_if: plannedIfVal,
          source: 'plan',
        });
        workouts.push(w);
        created.push(w.id);
        const earliest = dayDate < firstDay ? dayDate : firstDay;
        await store.recomputeSeries(client, athlete.id, earliest < todayDate ? earliest : todayDate);
      }
      if (mode === 'event' && eventName) {
        await client.query(`DELETE FROM events WHERE athlete_id = $1 AND date = $2`, [athlete.id, date]);
        await client.query(`INSERT INTO events (id, athlete_id, name, date) VALUES ($1,$2,$3,$4)`, [randomUUID(), athlete.id, eventName, date]);
      }
    });
    liveHub.broadcast({ athlete_id: athlete.id, what: 'workouts' });
    if (mode === 'event' && eventName) liveHub.broadcast({ athlete_id: athlete.id, what: 'events' });
    return {
      created: created.length,
      skipped,
      kept: keptDays.size,
      first_day: firstDay,
      last_day: addDays(firstDay, totalDays - 1),
      workouts: workouts.map(workoutToJson),
    };
  };

  function weekNumberOf(day: number, weeks: number): number {
    void weeks;
    return Math.ceil(day / 7);
  }

  function scaleDuration(durationS: number, weekNumber: number): number {
    const scaled = isRestWeek(weekNumber) ? durationS * 0.6 : durationS;
    const snapped = Math.round(scaled / 30) * 30;
    return Math.max(30, snapped);
  }

  function scaleRestWeek(steps: Step[], weekNumber: number): Step[] {
    if (!isRestWeek(weekNumber)) return steps;
    return steps.map((step) => {
      if (step.kind === 'interval') {
        return {
          kind: 'interval' as const,
          repeat: step.repeat,
          work: scalePart(step.work),
          recovery: scalePart(step.recovery),
        };
      }
      return {
        kind: step.kind,
        duration_s: snapDuration(step.duration_s * 0.6),
        target_pct: step.target_pct,
      };
    });
  }

  function scalePart(part: { duration_s: number; target_pct: number }): { duration_s: number; target_pct: number } {
    return { duration_s: snapDuration(part.duration_s * 0.6), target_pct: part.target_pct };
  }

  function snapDuration(seconds: number): number {
    return Math.max(30, Math.round(seconds / 30) * 30);
  }

  function isRestWeek(weekNumber: number): boolean {
    return weekNumber % 4 === 0;
  }

  function parsePlanWeeks(value: unknown, errors: FieldErrors): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 24) {
      errors.add('weeks', MESSAGES.weeks);
      return 0;
    }
    return value;
  }

  function parsePlanEntries(value: unknown, weeks: number, errors: FieldErrors): PlanEntry[] {
    if (!Array.isArray(value) || value.length === 0) {
      errors.add('entries', MESSAGES.stepsEmpty);
      return [];
    }
    const out: PlanEntry[] = [];
    for (const raw of value) {
      if (typeof raw !== 'object' || raw === null) {
        errors.add('entries', MESSAGES.stepsEmpty);
        return [];
      }
      const r = raw as Record<string, unknown>;
      const day = r.day;
      if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > weeks * 7) {
        errors.add('entries', MESSAGES.date);
        return [];
      }
      if (typeof r.start_local !== 'string' || !/^\d{2}:\d{2}$/.test(r.start_local)) {
        errors.add('entries', MESSAGES.startLocal);
        return [];
      }
      const sport = r.sport === 'bike' || r.sport === 'run' ? r.sport : null;
      if (!sport) {
        errors.add('entries', MESSAGES.sport);
        return [];
      }
      const title = typeof r.title === 'string' && r.title.length >= 1 && r.title.length <= 80 ? r.title : null;
      if (!title) {
        errors.add('entries', MESSAGES.title);
        return [];
      }
      if (r.steps !== undefined) {
        const steps = parseSteps(r.steps, errors, 'entries');
        if (steps === null) return [];
        out.push({ day, start_local: r.start_local, sport, title, steps, duration_s: null });
      } else if (r.duration_s !== undefined) {
        const duration = parsePlanDuration(r.duration_s, errors);
        if (duration === null) return [];
        out.push({ day, start_local: r.start_local, sport, title, steps: null, duration_s: duration });
      } else {
        errors.add('entries', MESSAGES.duration);
        return [];
      }
    }
    return out;
  }

  function parsePlanDuration(value: unknown, errors: FieldErrors): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 60 || value > 14400) {
      errors.add('entries', MESSAGES.duration);
      return null;
    }
    return value;
  }

  // ------------------------------------------------------------------ copy week

  router.post('/athletes/:id/copy-week', wrap(async (req, res) => {
    const user = requireAuth(req);
    if (user.role !== 'coach') throw notFound();
    const body = req.body as Record<string, unknown>;
    const errors = new FieldErrors();
    const week = typeof body.week === 'string' && isIsoWeek(body.week) ? body.week : null;
    if (!week) errors.add('week', MESSAGES.week);
    const toWeek = typeof body.to_week === 'string' && isIsoWeek(body.to_week) ? body.to_week : null;
    if (!toWeek) errors.add('to_week', MESSAGES.week);
    const workoutIds = Array.isArray(body.workout_ids) ? body.workout_ids.filter((id): id is string => typeof id === 'string') : null;
    if (!workoutIds || workoutIds.length === 0) errors.add('workout_ids', MESSAGES.workoutIds);
    const athlete = await store.canViewAthlete(store.db, user.id, req.params.id!);
    const toAthleteId = typeof body.to_athlete_id === 'string' ? body.to_athlete_id : '';
    const toAthlete = await store.canViewAthlete(store.db, user.id, toAthleteId);
    errors.throwIfAny();

    const sourceMonday = mondayFromWeek(week!);
    const targetMonday = mondayFromWeek(toWeek!);
    const todayDate = today();
    const workouts: WorkoutRow[] = [];
    let skipped = 0;

    await withTransaction(async (client) => {
      for (const id of workoutIds!) {
        const workout = await store.getWorkout(client, id);
        if (workout.athlete_id !== athlete.id || workout.kind !== 'planned') {
          throw new ValidationError({ workout_ids: MESSAGES.workoutIds });
        }
        const weekday = daysBetween(sourceMonday, workout.date);
        const targetDate = addDays(targetMonday, weekday);
        if (targetDate < todayDate) {
          skipped += 1;
          continue;
        }
        const w = await store.insertWorkout(client, {
          athlete_id: toAthlete.id,
          kind: 'planned',
          sport: workout.sport,
          title: workout.title,
          date: targetDate,
          start_local: workout.start_local,
          duration_s: workout.duration_s,
          steps: workout.steps,
          planned_tss: workout.planned_tss,
          planned_if: workout.planned_if,
          source: 'copy',
        });
        workouts.push(w);
      }
      await store.recomputeSeries(client, toAthlete.id, targetMonday < todayDate ? targetMonday : todayDate);
    });
    liveHub.broadcast({ athlete_id: toAthlete.id, what: 'workouts' });
    liveHub.broadcast({ athlete_id: athlete.id, what: 'workouts' });
    res.status(201).json({ created: workouts.length, skipped, workouts: workouts.map(workoutToJson) });
  }));

  // ------------------------------------------------------------------ links

  router.post('/links', wrap(async (req, res) => {
    const user = requireAuth(req);
    if (user.role !== 'athlete') throw notFound();
    const body = (req.body ?? {}) as { coach_code?: unknown };
    const code = typeof body.coach_code === 'string' ? body.coach_code.trim() : '';
    const coach = code ? await store.findByCoachCode(store.db, code) : null;
    if (!coach) throw new ValidationError({ coach_code: MESSAGES.coachCode });
    const existing = await store.db.query(
      `SELECT id, status, expires_at FROM links WHERE coach_id = $1 AND athlete_id = $2`,
      [coach.id, user.id]
    );
    const now = new Date();
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as { status: string; expires_at: Date | null };
      if (row.status === 'accepted') throw conflict('already_linked', CONFLICT_MESSAGES.already_linked);
      if (row.status === 'requested' && row.expires_at !== null && row.expires_at > now) {
        throw conflict('already_requested', CONFLICT_MESSAGES.already_requested);
      }
      await store.db.query(`DELETE FROM links WHERE id = $1`, [(existing.rows[0] as { id: string }).id]);
    }
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + ctx.config.linkRequestTtlHours * 3600 * 1000);
    await store.db.query(
      `INSERT INTO links (id, coach_id, athlete_id, status, expires_at) VALUES ($1,$2,$3,'requested',$4)`,
      [id, coach.id, user.id, expiresAt.toISOString()]
    );
    liveHub.broadcast({ athlete_id: coach.id, what: 'links' });
    liveHub.notifyUser(coach.id, `${user.name} sent a link request.`);
    res.status(201).json({
      link: {
        id,
        coach_id: coach.id,
        coach_name: coach.name,
        athlete_id: user.id,
        athlete_name: user.name,
        status: 'requested',
        expires_at: expiresAt.toISOString(),
      },
    });
  }));

  router.get('/links', wrap(async (req, res) => {
    const user = requireAuth(req);
    const rows = await store.db.query(
      `SELECT l.id, l.coach_id, l.athlete_id, l.status, l.expires_at,
              c.name as coach_name, a.name as athlete_name
       FROM links l
       JOIN users c ON c.id = l.coach_id
       JOIN users a ON a.id = l.athlete_id
       WHERE (l.coach_id = $1 AND l.athlete_id = $1) OR l.coach_id = $1 OR l.athlete_id = $1`,
      [user.id]
    );
    const now = new Date();
    const links = rows.rows.map((r) => {
      const status =
        r.status === 'requested' && r.expires_at !== null && new Date(r.expires_at).getTime() <= now.getTime()
          ? 'expired'
          : r.status;
      return {
        id: r.id,
        coach_id: r.coach_id,
        coach_name: r.coach_name,
        athlete_id: r.athlete_id,
        athlete_name: r.athlete_name,
        status,
        expires_at: r.expires_at === null ? null : new Date(r.expires_at).toISOString(),
      };
    });
    res.json({ links });
  }));

  router.post('/links/:id/accept', wrap(async (req, res) => {
    await settleLink(req, res, 'accepted');
  }));

  router.post('/links/:id/decline', wrap(async (req, res) => {
    await settleLink(req, res, 'declined');
  }));

  async function settleLink(req: Request, res: Response, next: 'accepted' | 'declined'): Promise<void> {
    const user = requireAuth(req);
    if (user.role !== 'coach') throw notFound();
    const row = await store.db.query(
      `SELECT id, coach_id, athlete_id, status, expires_at FROM links WHERE id = $1`,
      [req.params.id!]
    );
    if (row.rows.length === 0 || (row.rows[0] as { coach_id: string }).coach_id !== user.id) throw notFound();
    const link = row.rows[0] as { id: string; coach_id: string; athlete_id: string; status: string; expires_at: Date | null };
    if (link.status !== 'requested') throw conflict('not_pending', CONFLICT_MESSAGES.not_pending);
    if (link.expires_at !== null && new Date(link.expires_at).getTime() <= Date.now()) {
      throw conflict('expired', CONFLICT_MESSAGES.expired);
    }
    const updated = await store.db.query(
      `UPDATE links SET status = $1 WHERE id = $2 AND status = 'requested' RETURNING id`,
      [next, link.id]
    );
    if (updated.rows.length === 0) throw conflict('not_pending', CONFLICT_MESSAGES.not_pending);
    liveHub.broadcast({ athlete_id: link.athlete_id, what: 'links' });
    liveHub.broadcast({ athlete_id: link.coach_id, what: 'links' });
    const athlete = await store.getUser(store.db, link.athlete_id);
    res.json({
      link: {
        id: link.id,
        coach_id: link.coach_id,
        coach_name: user.name,
        athlete_id: link.athlete_id,
        athlete_name: athlete.name,
        status: next,
        expires_at: null,
      },
    });
  }

  router.delete('/links/:id', wrap(async (req, res) => {
    const user = requireAuth(req);
    const row = await store.db.query(
      `SELECT id, coach_id, athlete_id, status FROM links WHERE id = $1`,
      [req.params.id!]
    );
    if (row.rows.length === 0) throw notFound();
    const link = row.rows[0] as { id: string; coach_id: string; athlete_id: string; status: string };
    if (link.coach_id !== user.id && link.athlete_id !== user.id) throw notFound();
    if (link.status === 'requested') {
      await store.db.query(`UPDATE links SET status = 'removed' WHERE id = $1`, [link.id]);
    } else if (link.status === 'accepted') {
      await store.db.query(`UPDATE links SET status = 'removed' WHERE id = $1`, [link.id]);
    } else {
      throw conflict('not_pending', CONFLICT_MESSAGES.not_pending);
    }
    liveHub.broadcast({ athlete_id: link.coach_id, what: 'links' });
    liveHub.broadcast({ athlete_id: link.athlete_id, what: 'links' });
    res.status(204).end();
  }));

  return router;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== 'string' || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

async function bcryptVerify(db: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }, password: string, userId: string): Promise<boolean> {
  const bcrypt = await import('bcryptjs');
  const res = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  if (res.rows.length === 0) return false;
  const hash = (res.rows[0] as { password_hash: string }).password_hash;
  return bcrypt.compare(password, hash);
}


