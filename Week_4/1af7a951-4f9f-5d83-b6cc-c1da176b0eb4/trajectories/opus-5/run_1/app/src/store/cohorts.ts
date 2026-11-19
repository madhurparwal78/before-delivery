import { oneRow, rows, type Queryable } from '../db/pool.js';
import { cohortStanding, seatsLeft, type CohortPhase, type CohortStanding } from '../domain/cohort.js';
import type { DateKey } from '../domain/time.js';

export interface CohortRow {
  readonly id: string;
  readonly coach_id: string;
  readonly name: string;
  readonly starts_on: DateKey;
  readonly published_at: Date | null;
  readonly closed_at: Date | null;
  readonly price_cents: number;
  readonly seats: number;
  readonly coach_name: string;
  readonly coach_email: string;
  readonly coach_tz: string;
  readonly active_enrollments: number;
}

export interface CohortView {
  readonly id: string;
  readonly name: string;
  readonly coach_name: string;
  readonly starts_on: DateKey;
  readonly phase: CohortPhase;
  readonly week: number | null;
  readonly price_cents: number;
  readonly seats: number;
  readonly seats_left: number;
}

const COHORT_SELECT = `
  select c.id, c.coach_id, c.name, c.starts_on, c.published_at, c.closed_at, c.price_cents, c.seats,
         h.name as coach_name, h.email as coach_email, h.time_zone as coach_tz,
         (select count(*) from enrollments e where e.cohort_id = c.id and e.status = 'active')::int
           as active_enrollments
    from cohorts c
    join coaches h on h.id = c.coach_id`;

export function standingOf(row: CohortRow, now: Date): CohortStanding {
  return cohortStanding(
    {
      startsOn: row.starts_on,
      publishedAt: row.published_at,
      closedAt: row.closed_at,
      coachTz: row.coach_tz,
    },
    now,
  );
}

export function cohortView(row: CohortRow, now: Date): CohortView {
  const standing = standingOf(row, now);
  return {
    id: row.id,
    name: row.name,
    coach_name: row.coach_name,
    starts_on: row.starts_on,
    phase: standing.phase,
    week: standing.week,
    price_cents: row.price_cents,
    seats: row.seats,
    seats_left: seatsLeft(row.seats, row.active_enrollments),
  };
}

export async function findCohort(id: string, client?: Queryable): Promise<CohortRow | null> {
  return oneRow<CohortRow>(`${COHORT_SELECT} where c.id = $1`, [id], client);
}

export async function listAllCohorts(): Promise<CohortRow[]> {
  return rows<CohortRow>(`${COHORT_SELECT} order by c.starts_on, c.name`);
}

export async function listCoachCohorts(coachId: string): Promise<CohortRow[]> {
  return rows<CohortRow>(`${COHORT_SELECT} where c.coach_id = $1 order by c.starts_on, c.name`, [
    coachId,
  ]);
}

export async function findCohortForCoach(
  id: string,
  coachId: string,
  client?: Queryable,
): Promise<CohortRow | null> {
  return oneRow<CohortRow>(
    `${COHORT_SELECT} where c.id = $1 and c.coach_id = $2`,
    [id, coachId],
    client,
  );
}
