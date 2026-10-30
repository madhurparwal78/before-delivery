import { one, query, type Queryable } from '../db/pool.js';
import { ACTIVE_ENROLMENT_STATES } from '../domain/enrolment.js';
import { endOfProviderDay, instantToIso } from '../domain/providerTime.js';
import { hasExpired } from '../domain/expiry.js';

export interface CohortRow {
  readonly id: string;
  readonly course_id: string;
  readonly name: string;
  readonly seat_cap: number;
  readonly starts_on: string;
  readonly close_date: string;
}

export interface RosterEntry {
  readonly enrolment_id: string;
  readonly nurse_name: string;
  readonly state: string;
}

export interface WaitlistEntry {
  readonly position: number;
  readonly nurse_name: string;
  readonly joined_at: string;
}

export interface CohortJson {
  readonly id: string;
  readonly course_id: string;
  readonly name: string;
  readonly starts_on: string;
  readonly close_date: string;
  readonly closes_at: string;
  readonly seat_cap: number;
  readonly seats_remaining: number;
  readonly open: boolean;
  readonly roster?: readonly RosterEntry[];
  readonly waitlist?: readonly WaitlistEntry[];
}

const COHORT_SELECT = 'SELECT id, course_id, name, seat_cap, starts_on, close_date FROM cohorts';

export async function getCohort(client: Queryable, id: string): Promise<CohortRow | null> {
  return one<CohortRow>(client, `${COHORT_SELECT} WHERE id = $1`, [id]);
}

export async function getCohortForUpdate(client: Queryable, id: string): Promise<CohortRow | null> {
  const locked = await one<{ id: string }>(client, 'SELECT id FROM cohorts WHERE id = $1 FOR UPDATE', [id]);
  if (locked === null) return null;
  return getCohort(client, id);
}

export async function listCohorts(client: Queryable, courseId: string): Promise<CohortRow[]> {
  return query<CohortRow>(client, `${COHORT_SELECT} WHERE course_id = $1 ORDER BY created_at`, [courseId]);
}

/** Seats remaining is always recomputed from the enrolment rows, never stored. */
export async function activeEnrolmentCount(client: Queryable, cohortId: string): Promise<number> {
  const row = await one<{ count: string }>(
    client,
    `SELECT count(*)::text AS count FROM enrolments WHERE cohort_id = $1 AND state = ANY($2)`,
    [cohortId, ACTIVE_ENROLMENT_STATES],
  );
  return row === null ? 0 : Number.parseInt(row.count, 10);
}

export function closesAt(cohort: CohortRow): Date {
  return endOfProviderDay(cohort.close_date);
}

export function isOpen(cohort: CohortRow, at: Date): boolean {
  return !hasExpired(closesAt(cohort), at);
}

export async function roster(client: Queryable, cohortId: string): Promise<RosterEntry[]> {
  return query<RosterEntry>(
    client,
    `SELECT e.id AS enrolment_id, u.display_name AS nurse_name, e.state
     FROM enrolments e JOIN users u ON u.id = e.user_id
     WHERE e.cohort_id = $1 ORDER BY e.enrolled_at`,
    [cohortId],
  );
}

/** Positions are 1-based among current entries, ordered by join instant then write order. */
export async function waitlist(client: Queryable, cohortId: string): Promise<WaitlistEntry[]> {
  const rows = await query<{ nurse_name: string; joined_at: Date }>(
    client,
    `SELECT u.display_name AS nurse_name, w.joined_at
     FROM waitlist_entries w JOIN users u ON u.id = w.user_id
     WHERE w.cohort_id = $1 ORDER BY w.joined_at, w.seq`,
    [cohortId],
  );
  return rows.map((row, index) => ({
    position: index + 1,
    nurse_name: row.nurse_name,
    joined_at: instantToIso(row.joined_at),
  }));
}

export async function waitlistPosition(
  client: Queryable,
  cohortId: string,
  userId: string,
): Promise<{ position: number; joined_at: string } | null> {
  const rows = await query<{ user_id: string; joined_at: Date }>(
    client,
    `SELECT user_id, joined_at FROM waitlist_entries WHERE cohort_id = $1 ORDER BY joined_at, seq`,
    [cohortId],
  );
  const index = rows.findIndex((row) => row.user_id === userId);
  const found = rows[index];
  if (found === undefined) return null;
  return { position: index + 1, joined_at: instantToIso(found.joined_at) };
}

export async function cohortJson(
  client: Queryable,
  cohort: CohortRow,
  viewerIsPlanner: boolean,
  at: Date,
): Promise<CohortJson> {
  const taken = await activeEnrolmentCount(client, cohort.id);
  const base: CohortJson = {
    id: cohort.id,
    course_id: cohort.course_id,
    name: cohort.name,
    starts_on: cohort.starts_on,
    close_date: cohort.close_date,
    closes_at: instantToIso(closesAt(cohort)),
    seat_cap: cohort.seat_cap,
    seats_remaining: Math.max(0, cohort.seat_cap - taken),
    open: isOpen(cohort, at),
  };
  if (!viewerIsPlanner) return base;
  return {
    ...base,
    roster: await roster(client, cohort.id),
    waitlist: await waitlist(client, cohort.id),
  };
}

export async function cohortsJson(
  client: Queryable,
  courseId: string,
  viewerIsPlanner: boolean,
  at: Date,
): Promise<CohortJson[]> {
  const rows = await listCohorts(client, courseId);
  const out: CohortJson[] = [];
  for (const row of rows) out.push(await cohortJson(client, row, viewerIsPlanner, at));
  return out;
}
