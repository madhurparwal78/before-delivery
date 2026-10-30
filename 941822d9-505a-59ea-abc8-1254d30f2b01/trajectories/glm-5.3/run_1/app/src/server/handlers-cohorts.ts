import { err, notFound, validationError } from "./errors.ts";
import { query, withSerializable } from "./db.ts";
import { serialiseCohort } from "./dto.ts";
import { cohortOpen, seatsRemaining } from "./cohorts.ts";
import { findCourse } from "./handlers-courses.ts";
import { isIsoDate } from "./time.ts";
import type { Ctx } from "./route.ts";
import { uuidOr404 } from "./validation.ts";
import { pathParam } from "./route.ts";
import type { PoolClient } from "pg";

type CohortRow = {
  id: string;
  course_id: string;
  name: string;
  starts_on: string;
  close_date: string;
  seat_cap: number;
};

async function loadCohort(id: string): Promise<CohortRow | null> {
  const { rows } = await query<CohortRow>(
    `SELECT id, course_id, name, to_char(starts_on,'YYYY-MM-DD') AS starts_on,
            to_char(close_date,'YYYY-MM-DD') AS close_date, seat_cap
       FROM cohorts WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

const activeCount = async (client: PoolClient, cohortId: string): Promise<number> => {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM enrolments WHERE cohort_id = $1 AND state IN ('held','confirmed','completed','certified')`,
    [cohortId],
  );
  return Number(rows[0]?.n ?? 0);
};

export async function createCohort(ctx: Ctx): Promise<void> {
  const course = await findCourse(uuidOr404(pathParam(ctx, "id")));
  if (!course) throw notFound();
  if (course.format !== "cohort" || course.state !== "published") throw err(409, "course_not_open");

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!["name", "seat_cap", "starts_on", "close_date"].includes(key)) errors[key] = "This field is not accepted.";
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > 80) errors.name = "Enter a cohort name of 1 to 80 characters.";
  const seatCap = typeof body.seat_cap === "number" && Number.isInteger(body.seat_cap) ? body.seat_cap : null;
  if (seatCap === null || seatCap < 1 || seatCap > 500) errors.seat_cap = "Seat cap must be a whole number from 1 to 500.";
  const startsOn = body.starts_on;
  const closeDate = body.close_date;
  if (typeof startsOn !== "string" || !isIsoDate(startsOn)) errors.starts_on = "Enter the start date as YYYY-MM-DD.";
  if (typeof closeDate !== "string" || !isIsoDate(closeDate)) errors.close_date = "Enrolment must close on or before the start date.";
  if (
    typeof startsOn === "string" && isIsoDate(startsOn) &&
    typeof closeDate === "string" && isIsoDate(closeDate) &&
    closeDate > startsOn
  ) {
    errors.close_date = "Enrolment must close on or before the start date.";
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);

  const { rows } = await query<{ id: string }>(
    `INSERT INTO cohorts (id, course_id, name, starts_on, close_date, seat_cap)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id`,
    [course.id, name, startsOn, closeDate, seatCap],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("cohort insert failed");
  const cohort = await loadCohort(id);
  if (!cohort) throw notFound();
  ctx.res.status(201).json({
    cohort: serialiseCohort({ ...cohort, seats_remaining: cohort.seat_cap }, true),
  });
}

export async function getCohort(ctx: Ctx): Promise<void> {
  const cohort = await loadCohort(uuidOr404(pathParam(ctx, "id")));
  if (!cohort) throw notFound();
  const course = await findCourse(cohort.course_id);
  if (!course) throw notFound();
  if (!(course.state === "published" || course.state === "withdrawn" || ctx.user.role === "planner" || (ctx.user.role === "author" && course.author_id === ctx.user.id))) {
    throw notFound();
  }
  const forPlanner = ctx.user.role === "planner";
  const { rows } = await query<{
    roster: Array<{ enrolment_id: string; nurse_name: string; state: string }>;
    waitlist: Array<{ position: number; nurse_name: string; joined_at: string }>;
    active: string;
  }>(
    `SELECT co.id,
            COALESCE((SELECT json_agg(json_build_object('enrolment_id', e.id, 'nurse_name', u.display_name, 'state', e.state)
                              ORDER BY u.display_name)
                        FROM enrolments e JOIN users u ON u.id = e.nurse_id
                       WHERE e.cohort_id = co.id AND e.state IN ('held','confirmed','completed','certified')), '[]') AS roster,
            COALESCE((SELECT json_agg(json_build_object('position', w.rn, 'nurse_name', u.display_name, 'joined_at', w.joined_at)
                              ORDER BY w.rn)
                        FROM (SELECT w2.*, row_number() OVER (ORDER BY w2.seq) AS rn
                                FROM waitlist_entries w2 WHERE w2.cohort_id = co.id) w
                        JOIN users u ON u.id = w.nurse_id), '[]') AS waitlist,
            (SELECT count(*) FROM enrolments e
               WHERE e.cohort_id = co.id AND e.state IN ('held','confirmed','completed','certified'))::text AS active
       FROM cohorts co WHERE co.id = $1`,
    [cohort.id],
  );
  const detail = rows[0];
  if (!detail) throw notFound();
  ctx.res.json({
    cohort: serialiseCohort(
      {
        ...cohort,
        seats_remaining: seatsRemaining(cohort.seat_cap, Number(detail.active)),
        roster: detail.roster,
        waitlist: detail.waitlist.map((w) => ({ ...w, joined_at: new Date(w.joined_at).toISOString() })),
      },
      forPlanner,
    ),
  });
}

export async function patchCohort(ctx: Ctx): Promise<void> {
  const cohort = await loadCohort(uuidOr404(pathParam(ctx, "id")));
  if (!cohort) throw notFound();

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "seat_cap") errors[key] = "This field is not accepted.";
  }
  const seatCap = typeof body.seat_cap === "number" && Number.isInteger(body.seat_cap) ? body.seat_cap : null;
  if (seatCap === null || seatCap < 1 || seatCap > 500) errors.seat_cap = "Seat cap must be a whole number from 1 to 500.";
  if (Object.keys(errors).length > 0) throw validationError(errors);

  const active = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM enrolments WHERE cohort_id = $1 AND state IN ('held','confirmed','completed','certified')`,
    [cohort.id],
  );
  if (seatCap !== null && seatCap < Number(active.rows[0]?.n ?? 0)) throw err(409, "cap_below_enrolled");

  await query(`UPDATE cohorts SET seat_cap = $2 WHERE id = $1`, [cohort.id, seatCap]);
  const fresh = await loadCohort(cohort.id);
  if (!fresh) throw notFound();
  const count = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM enrolments WHERE cohort_id = $1 AND state IN ('held','confirmed','completed','certified')`,
    [cohort.id],
  );
  ctx.res.json({
    cohort: serialiseCohort({ ...fresh, seats_remaining: seatsRemaining(fresh.seat_cap, Number(count.rows[0]?.n ?? 0)) }, true),
  });
}

export async function joinWaitlist(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const unaccepted: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    unaccepted[key] = "This field is not accepted.";
  }
  const cohort = await loadCohort(uuidOr404(pathParam(ctx, "id")));
  if (!cohort) throw notFound();

  const { rows: existingEntry } = await query<{ position: string; joined_at: Date }>(
    `SELECT row_number() OVER (ORDER BY w.seq)::text AS position, w.joined_at
       FROM waitlist_entries w
       JOIN (SELECT w2.id, row_number() OVER (ORDER BY w2.seq) AS rn FROM waitlist_entries w2 WHERE w2.cohort_id = $2) ranked
         ON ranked.id = w.id
      WHERE w.cohort_id = $2 AND w.nurse_id = $1`,
    [ctx.user.id, cohort.id],
  );
  const mine = existingEntry[0];
  if (mine) {
    ctx.res.status(200).json({ waitlist_entry: { position: Number(mine.position), joined_at: mine.joined_at.toISOString() } });
    return;
  }

  const { rows: existing } = await query<{ id: string }>(
    `SELECT id FROM enrolments WHERE nurse_id = $1 AND course_id = $2 AND state IN ('held','confirmed','completed','certified')`,
    [ctx.user.id, cohort.course_id],
  );
  if (existing.length > 0) throw err(409, "already_enrolled");
  if (!cohortOpen(cohort.close_date)) throw err(409, "enrolment_closed");
  const count = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM enrolments WHERE cohort_id = $1 AND state IN ('held','confirmed','completed','certified')`,
    [cohort.id],
  );
  if (seatsRemaining(cohort.seat_cap, Number(count.rows[0]?.n ?? 0)) > 0) {
    throw err(409, "seats_available");
  }
  if (Object.keys(unaccepted).length > 0) throw validationError(unaccepted);

  const entry = await withSerializable(async (client) => {
    const { rows } = await client.query<{ id: string; joined_at: Date; position: string }>(
      `INSERT INTO waitlist_entries (id, cohort_id, nurse_id, joined_at)
       VALUES (gen_random_uuid(), $1, $2, now())
       ON CONFLICT (cohort_id, nurse_id) DO UPDATE SET nurse_id = EXCLUDED.nurse_id
       RETURNING id, joined_at`,
      [cohort.id, ctx.user.id],
    );
    const row = rows[0];
    if (!row) throw new Error("waitlist insert failed");
    const { rows: posRows } = await client.query<{ position: string }>(
      `SELECT row_number() OVER (ORDER BY w.seq)::text AS position
         FROM waitlist_entries w WHERE w.cohort_id = $1 AND w.id = $2`,
      [cohort.id, row.id],
    );
    return { joined_at: row.joined_at, position: Number(posRows[0]?.position ?? 1) };
  });

  // A learner who enrols is removed from that cohort's waitlist.
  await query(`DELETE FROM waitlist_entries WHERE cohort_id = $1 AND nurse_id = $2 AND EXISTS (
    SELECT 1 FROM enrolments e WHERE e.nurse_id = $2 AND e.course_id = $3 AND e.state IN ('held','confirmed','completed','certified'))`, [
    cohort.id,
    ctx.user.id,
    cohort.course_id,
  ]).catch(() => undefined);

  ctx.res.status(201).json({ waitlist_entry: { position: entry.position, joined_at: entry.joined_at.toISOString() } });
}

export async function leaveWaitlist(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const unaccepted: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    unaccepted[key] = "This field is not accepted.";
  }
  const cohort = await loadCohort(uuidOr404(pathParam(ctx, "id")));
  if (!cohort) throw notFound();
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM waitlist_entries WHERE cohort_id = $1 AND nurse_id = $2`,
    [cohort.id, ctx.user.id],
  );
  if (rows.length === 0) throw notFound();
  if (Object.keys(unaccepted).length > 0) throw validationError(unaccepted);
  await query(`DELETE FROM waitlist_entries WHERE id = $1`, [rows[0]?.id]);
  ctx.res.status(204).end();
}
