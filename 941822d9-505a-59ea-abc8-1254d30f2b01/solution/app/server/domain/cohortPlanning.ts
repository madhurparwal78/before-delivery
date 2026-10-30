import { randomUUID } from "node:crypto";
import { claimRow, db, one, tx } from "../db.js";
import { conflict, forbidden, notFound, Validation } from "../http/errors.js";
import { cohortRow, hasOpenEnrolment } from "./checkout.js";
import { cohortsJson, isOpen, seatsRemaining, seatsTaken, waitlist, type CohortRow } from "./cohorts.js";
import { readableCourse } from "./courses.js";
import { provider } from "./provider.js";
import { cohortClosesAt, isCalendarDate } from "./time.js";
import type { SessionUser } from "./users.js";

const SEAT_CAP_MESSAGE = "Seat cap must be a whole number from 1 to 500.";

const validSeatCap = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 500;

async function cohortJson(cohort: CohortRow, viewer: SessionUser, at: Date): Promise<Record<string, unknown>> {
  const [json] = await cohortsJson(db, [cohort], viewer, at);
  return json ?? {};
}

/** A cohort readable by whoever can read its course. */
async function readableCohort(viewer: SessionUser, id: unknown): Promise<CohortRow> {
  const cohort = await cohortRow(db, id);
  if (!cohort) throw notFound();
  await readableCourse(db, viewer, cohort.course_id);
  return cohort;
}

export async function readCohort(viewer: SessionUser, id: unknown, at: Date): Promise<Record<string, unknown>> {
  return cohortJson(await readableCohort(viewer, id), viewer, at);
}

export async function createCohort(planner: SessionUser, courseId: unknown, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  const course = await readableCourse(db, planner, courseId);
  if (planner.role !== "planner") throw forbidden();
  if (course.format !== "cohort" || course.state !== "published") throw conflict("course_not_open");
  const v = new Validation(body, ["name", "seat_cap", "starts_on", "close_date"]);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 80) v.add("name", "Enter a cohort name of 1 to 80 characters.");
  if (!validSeatCap(body.seat_cap)) v.add("seat_cap", SEAT_CAP_MESSAGE);
  const { starts_on: startsOn, close_date: closeDate } = body;
  if (!isCalendarDate(startsOn)) v.add("starts_on", "Enter a start date as YYYY-MM-DD.");
  if (!isCalendarDate(closeDate) || (isCalendarDate(startsOn) && closeDate > startsOn)) v.add("close_date", "Enrolment must close on or before the start date.");
  v.done();
  const close = String(closeDate);
  const cohort: CohortRow = {
    id: randomUUID(),
    course_id: course.id,
    name,
    seat_cap: validSeatCap(body.seat_cap) ? body.seat_cap : 0,
    starts_on: String(startsOn),
    close_date: close,
    closes_at: cohortClosesAt(provider.timeZone, close),
  };
  await db.q(
    "INSERT INTO cohorts (id, course_id, name, seat_cap, starts_on, close_date, closes_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [cohort.id, cohort.course_id, cohort.name, cohort.seat_cap, cohort.starts_on, cohort.close_date, cohort.closes_at, at],
  );
  return cohortJson(cohort, planner, at);
}

/** Changes the seat cap; it can never go below the cohort's seat-holding enrolments. */
export async function changeSeatCap(planner: SessionUser, id: unknown, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  const cohort = await readableCohort(planner, id);
  if (planner.role !== "planner") throw forbidden();
  const v = new Validation(body, ["seat_cap"]);
  const cap = body.seat_cap;
  if (!validSeatCap(cap)) v.add("seat_cap", SEAT_CAP_MESSAGE);
  await tx(async (t) => {
    await claimRow(t, "cohorts", cohort.id);
    const taken = (await seatsTaken(t, [cohort.id])).get(cohort.id) ?? 0;
    // 409 conflicts run before 422 validation: any numeric cap below the enrolled count is the conflict, 0 included
    if (typeof cap === "number" && Number.isFinite(cap) && cap < taken) throw conflict("cap_below_enrolled");
    v.done();
    await t.q("UPDATE cohorts SET seat_cap = $2 WHERE id = $1", [cohort.id, cap]);
  });
  return readCohort(planner, cohort.id, at);
}

const entryJson = (entry: { position: number; joined_at: Date }): Record<string, unknown> => ({
  position: entry.position,
  joined_at: entry.joined_at.toISOString(),
});

/** Joins a full, open cohort's waitlist; a learner already on it gets the same entry back. */
export async function joinWaitlist(learner: SessionUser, id: unknown, body: Record<string, unknown>, at: Date): Promise<{ created: boolean; entry: Record<string, unknown> }> {
  const cohort = await readableCohort(learner, id);
  if (learner.role !== "learner") throw forbidden();
  // Joins on one cohort are written one at a time (the cohort row is claimed first), each stamped once it holds the
  // claim, so joined_at follows write order and simultaneous joiners get distinct, consecutive positions.
  return tx(async (t) => {
    await claimRow(t, "cohorts", cohort.id);
    const position = async () => (await waitlist(t, cohort.id)).find((w) => w.learner_id === learner.id);
    const existing = await position();
    if (existing) return { created: false, entry: entryJson(existing) };
    if (await hasOpenEnrolment(t, learner.id, cohort.course_id)) throw conflict("already_enrolled");
    if (!isOpen(cohort, at)) throw conflict("enrolment_closed");
    if (seatsRemaining(cohort, await seatsTaken(t, [cohort.id])) > 0) throw conflict("seats_available");
    new Validation(body, []).done();
    await t.q("INSERT INTO waitlist_entries (cohort_id, learner_id, joined_at) VALUES ($1, $2, clock_timestamp())", [cohort.id, learner.id]);
    const joined = await position();
    if (!joined) throw notFound();
    return { created: true, entry: entryJson(joined) };
  });
}

export async function leaveWaitlist(learner: SessionUser, id: unknown, body: Record<string, unknown>): Promise<void> {
  const cohort = await readableCohort(learner, id);
  if (learner.role !== "learner") throw forbidden();
  const entry = await one(db, "SELECT 1 FROM waitlist_entries WHERE cohort_id = $1 AND learner_id = $2", [cohort.id, learner.id]);
  if (!entry) throw notFound();
  new Validation(body, []).done();
  await db.q("DELETE FROM waitlist_entries WHERE cohort_id = $1 AND learner_id = $2", [cohort.id, learner.id]);
}
