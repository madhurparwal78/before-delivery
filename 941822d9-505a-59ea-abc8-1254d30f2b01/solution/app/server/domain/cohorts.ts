import type { Db } from "../db.js";
import type { SessionUser } from "./users.js";

export interface CohortRow {
  id: string;
  course_id: string;
  name: string;
  seat_cap: number;
  starts_on: string;
  close_date: string;
  closes_at: Date;
}

export const COHORT_COLUMNS = "id, course_id, name, seat_cap, starts_on, close_date, closes_at";

/** Enrolment states that hold a cohort seat; refunded and withdrawn enrolments free theirs. */
const SEAT_HOLDING = "('held', 'confirmed', 'completed', 'certified')";

/** Seats taken per cohort, counted from the enrolment rows on every read. */
export async function seatsTaken(t: Db, cohortIds: readonly string[]): Promise<Map<string, number>> {
  if (cohortIds.length === 0) return new Map();
  const rows = await t.q<{ cohort_id: string; taken: number }>(
    `SELECT cohort_id, count(*) AS taken FROM enrolments
      WHERE cohort_id = ANY($1::uuid[]) AND state IN ${SEAT_HOLDING} GROUP BY cohort_id`,
    [cohortIds],
  );
  return new Map(rows.map((r) => [r.cohort_id, r.taken]));
}

/** Seats remaining: the seat cap minus the cohort's seat-holding enrolments. */
export const seatsRemaining = (cohort: CohortRow, taken: Map<string, number>): number => cohort.seat_cap - (taken.get(cohort.id) ?? 0);

/** A cohort is open only while the instant is before its close instant. */
export const isOpen = (cohort: CohortRow, at: Date): boolean => at.getTime() < cohort.closes_at.getTime();

/** Waitlist entries in order of joining (ties by write order), with 1-based positions. */
export async function waitlist(t: Db, cohortId: string): Promise<{ position: number; learner_id: string; nurse_name: string; joined_at: Date }[]> {
  const rows = await t.q<{ learner_id: string; nurse_name: string; joined_at: Date }>(
    `SELECT w.learner_id, u.display_name AS nurse_name, w.joined_at FROM waitlist_entries w
       JOIN users u ON u.id = w.learner_id WHERE w.cohort_id = $1 ORDER BY w.joined_at, w.id`,
    [cohortId],
  );
  return rows.map((row, index) => ({ position: index + 1, ...row }));
}

/** The Cohort object; the nurse planner alone also sees the roster and the waitlist. */
export async function cohortsJson(t: Db, cohorts: readonly CohortRow[], viewer: SessionUser, at: Date): Promise<Record<string, unknown>[]> {
  const taken = await seatsTaken(t, cohorts.map((c) => c.id));
  const out: Record<string, unknown>[] = [];
  for (const cohort of cohorts) {
    const summary: Record<string, unknown> = {
      id: cohort.id,
      course_id: cohort.course_id,
      name: cohort.name,
      starts_on: cohort.starts_on,
      close_date: cohort.close_date,
      closes_at: cohort.closes_at.toISOString(),
      seat_cap: cohort.seat_cap,
      seats_remaining: seatsRemaining(cohort, taken),
      open: isOpen(cohort, at),
    };
    if (viewer.role === "planner") {
      const roster = await t.q<{ enrolment_id: string; nurse_name: string; state: string }>(
        `SELECT e.id AS enrolment_id, u.display_name AS nurse_name, e.state FROM enrolments e
           JOIN users u ON u.id = e.learner_id WHERE e.cohort_id = $1 AND e.state <> 'held' ORDER BY e.enrolled_at, e.id`,
        [cohort.id],
      );
      summary.roster = roster;
      summary.waitlist = (await waitlist(t, cohort.id)).map((w) => ({ position: w.position, nurse_name: w.nurse_name, joined_at: w.joined_at.toISOString() }));
    }
    out.push(summary);
  }
  return out;
}
