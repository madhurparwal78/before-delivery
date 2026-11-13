import { randomUUID } from 'node:crypto';
import { query, type Queryable } from './pool.js';
import type {
  AthleteEvent,
  Comment,
  LibraryItem,
  PlanEntry,
  PlanTemplate,
  SeriesDay,
  Sport,
  Step,
  Threshold,
  ThresholdKind,
} from '../domain/types.js';
import { plannedIf, plannedTss, stepsDurationS } from '../domain/steps.js';

export async function thresholdHistory(
  client: Queryable,
  athleteId: string,
): Promise<Threshold[]> {
  return query<Threshold>(
    client,
    `select kind, value, effective_from from thresholds
     where athlete_id = $1 order by effective_from, kind`,
    [athleteId],
  );
}

/** The threshold in force on a day: the latest entry of its kind on or before it. */
export async function thresholdOn(
  client: Queryable,
  athleteId: string,
  kind: ThresholdKind,
  date: string,
): Promise<number | null> {
  const rows = await query<{ value: number }>(
    client,
    `select value from thresholds
     where athlete_id = $1 and kind = $2 and effective_from <= $3
     order by effective_from desc limit 1`,
    [athleteId, kind, date],
  );
  return rows[0]?.value ?? null;
}

export async function upsertThreshold(
  client: Queryable,
  athleteId: string,
  threshold: Threshold,
): Promise<void> {
  await query(
    client,
    `insert into thresholds (id, athlete_id, kind, value, effective_from)
     values ($1,$2,$3,$4,$5)
     on conflict (athlete_id, kind, effective_from) do update set value = excluded.value`,
    [randomUUID(), athleteId, threshold.kind, threshold.value, threshold.effective_from],
  );
}

export async function thresholdExists(
  client: Queryable,
  athleteId: string,
  kind: ThresholdKind,
  effectiveFrom: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    client,
    'select id from thresholds where athlete_id = $1 and kind = $2 and effective_from = $3',
    [athleteId, kind, effectiveFrom],
  );
  return rows.length === 1;
}

/** The day before the next later entry of the same kind, or null when it is the last. */
export async function thresholdSpanEnd(
  client: Queryable,
  athleteId: string,
  kind: ThresholdKind,
  effectiveFrom: string,
): Promise<string | null> {
  const rows = await query<{ effective_from: string }>(
    client,
    `select effective_from from thresholds
     where athlete_id = $1 and kind = $2 and effective_from > $3
     order by effective_from limit 1`,
    [athleteId, kind, effectiveFrom],
  );
  return rows[0]?.effective_from ?? null;
}

interface LibraryRow {
  id: string;
  name: string;
  sport: Sport;
  steps: Step[];
}

export async function libraryForOwner(client: Queryable, ownerId: string): Promise<LibraryItem[]> {
  const rows = await query<LibraryRow>(
    client,
    'select id, name, sport, steps from library_items where owner_id = $1 order by seq',
    [ownerId],
  );
  return rows.map(toLibraryItem);
}

export async function findLibraryItem(
  client: Queryable,
  id: string,
  ownerId: string,
): Promise<LibraryItem | null> {
  const rows = await query<LibraryRow>(
    client,
    'select id, name, sport, steps from library_items where id = $1 and owner_id = $2',
    [id, ownerId],
  );
  const row = rows[0];
  return row ? toLibraryItem(row) : null;
}

function toLibraryItem(row: LibraryRow): LibraryItem {
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    steps: row.steps,
    duration_s: stepsDurationS(row.steps),
    planned_tss: plannedTss(row.steps),
    planned_if: plannedIf(row.steps),
  };
}

export async function insertLibraryItem(
  client: Queryable,
  args: { ownerId: string; name: string; sport: Sport; steps: Step[]; seedKey?: string | null },
): Promise<LibraryItem> {
  const rows = await query<LibraryRow>(
    client,
    `insert into library_items (id, owner_id, name, sport, steps, seed_key)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (seed_key) do update set owner_id = excluded.owner_id, name = excluded.name,
       sport = excluded.sport, steps = excluded.steps
     returning id, name, sport, steps`,
    [randomUUID(), args.ownerId, args.name, args.sport, JSON.stringify(args.steps), args.seedKey ?? null],
  );
  return toLibraryItem(rows[0] as LibraryRow);
}

export async function deleteLibraryItem(
  client: Queryable,
  id: string,
  ownerId: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    client,
    'delete from library_items where id = $1 and owner_id = $2 returning id',
    [id, ownerId],
  );
  return rows.length === 1;
}

interface PlanRow {
  id: string;
  name: string;
  weeks: number;
  entries: PlanEntry[];
}

export async function plansForOwner(client: Queryable, ownerId: string): Promise<PlanTemplate[]> {
  return query<PlanRow>(
    client,
    'select id, name, weeks, entries from plans where owner_id = $1 order by seq',
    [ownerId],
  );
}

export async function findPlan(
  client: Queryable,
  id: string,
  ownerId: string,
): Promise<PlanTemplate | null> {
  const rows = await query<PlanRow>(
    client,
    'select id, name, weeks, entries from plans where id = $1 and owner_id = $2',
    [id, ownerId],
  );
  return rows[0] ?? null;
}

export async function insertPlan(
  client: Queryable,
  args: { ownerId: string; name: string; weeks: number; entries: PlanEntry[]; seedKey?: string | null },
): Promise<PlanTemplate> {
  const rows = await query<PlanRow>(
    client,
    `insert into plans (id, owner_id, name, weeks, entries, seed_key)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (seed_key) do update set owner_id = excluded.owner_id, name = excluded.name,
       weeks = excluded.weeks, entries = excluded.entries
     returning id, name, weeks, entries`,
    [randomUUID(), args.ownerId, args.name, args.weeks, JSON.stringify(args.entries), args.seedKey ?? null],
  );
  return rows[0] as PlanTemplate;
}

export async function commentsForWorkout(client: Queryable, workoutId: string): Promise<Comment[]> {
  const rows = await query<{
    id: string;
    author_id: string;
    author_name: string;
    body: string;
    created_at: Date;
  }>(
    client,
    `select c.id, c.author_id, u.name as author_name, c.body, c.created_at
     from comments c join users u on u.id = c.author_id
     where c.workout_id = $1 order by c.seq`,
    [workoutId],
  );
  return rows.map((row) => ({
    id: row.id,
    author_id: row.author_id,
    author_name: row.author_name,
    body: row.body,
    created_at: row.created_at.toISOString(),
  }));
}

export async function insertComment(
  client: Queryable,
  args: { workoutId: string; authorId: string; body: string; seedKey?: string | null },
): Promise<string> {
  const rows = await query<{ id: string }>(
    client,
    `insert into comments (id, workout_id, author_id, body, seed_key) values ($1,$2,$3,$4,$5)
     on conflict (seed_key) do update set workout_id = excluded.workout_id,
       author_id = excluded.author_id, body = excluded.body
     returning id`,
    [randomUUID(), args.workoutId, args.authorId, args.body, args.seedKey ?? null],
  );
  return (rows[0] as { id: string }).id;
}

export async function eventsForAthlete(client: Queryable, athleteId: string): Promise<AthleteEvent[]> {
  return query<AthleteEvent>(
    client,
    'select name, date from events where athlete_id = $1 order by date, name',
    [athleteId],
  );
}

export async function upsertEvent(
  client: Queryable,
  athleteId: string,
  event: AthleteEvent,
): Promise<void> {
  await query(
    client,
    `insert into events (id, athlete_id, name, date) values ($1,$2,$3,$4)
     on conflict (athlete_id, name, date) do nothing`,
    [randomUUID(), athleteId, event.name, event.date],
  );
}

export async function seriesBetween(
  client: Queryable,
  athleteId: string,
  from: string,
  to: string,
): Promise<SeriesDay[]> {
  return query<SeriesDay>(
    client,
    `select date, tss, ctl, atl, tsb from series
     where athlete_id = $1 and date >= $2 and date <= $3 order by date`,
    [athleteId, from, to],
  );
}

export async function seriesDay(
  client: Queryable,
  athleteId: string,
  date: string,
): Promise<SeriesDay | null> {
  const rows = await query<SeriesDay>(
    client,
    'select date, tss, ctl, atl, tsb from series where athlete_id = $1 and date = $2',
    [athleteId, date],
  );
  return rows[0] ?? null;
}

export async function replaceSeriesFrom(
  client: Queryable,
  athleteId: string,
  from: string,
  days: SeriesDay[],
): Promise<void> {
  await query(client, 'delete from series where athlete_id = $1 and date >= $2', [athleteId, from]);
  if (days.length === 0) return;
  const values: unknown[] = [];
  const tuples = days.map((day, index) => {
    values.push(athleteId, day.date, day.tss, day.ctl, day.atl, day.tsb);
    const base = index * 6;
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
  });
  await query(
    client,
    `insert into series (athlete_id, date, tss, ctl, atl, tsb) values ${tuples.join(',')}`,
    values,
  );
}

