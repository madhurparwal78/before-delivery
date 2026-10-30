import { err, notFound, validationError } from "./errors.ts";
import { query, withSerializable, withTransaction } from "./db.ts";
import { serialiseEnrolment, serialiseQuote, type EnrolmentModule, type EnrolmentRow } from "./dto.ts";
import { centsToMoney, parseMoney } from "./money.ts";
import { policyInEffect, splitShares } from "./coverage.ts";
import { cohortOpen, seatsRemaining } from "./cohorts.ts";
import { validateKey, withIdempotency } from "./idempotency.ts";
import { PaymentsUnavailable, purchase, refund as kbRefund, findPurchase, transactionExists } from "./payments.ts";
import { findCourse } from "./handlers-courses.ts";
import { assertEnrolmentReadable } from "./access.ts";
import type { Ctx } from "./route.ts";
import { uuidOr404 } from "./validation.ts";
import { pathParam } from "./route.ts";
import type { PoolClient } from "pg";

type CohortRecord = { id: string; name: string; close_date: string; seat_cap: number };

export async function quoteForCourse(ctx: Ctx): Promise<void> {
  const course = await findCourse(ctx.query.get("course_id") ?? "");
  if (!course) throw notFound();
  if (course.state !== "published") throw notFound();
  ctx.res.json(serialiseQuote(await quoteFor(ctx.user.id, course.list_price_cents, ctx.user.organisation_id)));
}

export async function quoteFor(nurseId: string, listPriceCents: number, hospitalId: string | null): Promise<{
  list_price_cents: number;
  employer_share_cents: number;
  learner_share_cents: number;
  coverage_percent_h: number;
  sponsor: string | null;
}> {
  let percentH = 0;
  let sponsor: string | null = null;
  if (hospitalId) {
    const policy = await policyInEffect({ query }, hospitalId);
    percentH = policy.percentH;
    const { rows } = await query<{ name: string }>(`SELECT name FROM organisations WHERE id = $1`, [hospitalId]);
    sponsor = rows[0]?.name ?? null;
  }
  const split = splitShares(listPriceCents, percentH);
  return {
    list_price_cents: listPriceCents,
    employer_share_cents: split.employerCents,
    learner_share_cents: split.learnerCents,
    coverage_percent_h: percentH,
    sponsor,
  };
}

export async function checkout(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;

  const courseId = typeof body.course_id === "string" ? body.course_id : "";
  const course = await findCourse(uuidOr404(courseId));
  if (!course) throw notFound();
  if (course.state !== "published" && course.state !== "withdrawn") throw notFound();

  const rawCohortId = body.cohort_id;
  let cohort: CohortRecord | null = null;
  if (rawCohortId !== null && rawCohortId !== undefined) {
    if (typeof rawCohortId !== "string") throw notFound();
    const { rows } = await query<{ id: string; name: string; close_date: string; seat_cap: number; course_id: string }>(
      `SELECT id, name, to_char(close_date,'YYYY-MM-DD') AS close_date, seat_cap, course_id FROM cohorts WHERE id = $1`,
      [rawCohortId],
    );
    const found = rows[0];
    if (!found || found.course_id !== course.id) throw notFound();
    cohort = { id: found.id, name: found.name, close_date: found.close_date, seat_cap: found.seat_cap };
  }

  const key = validateKey((ctx.req.headers["idempotency-key"] as string | undefined) ?? undefined);

  const outcome = await withIdempotency(ctx.user.id, key, "checkout", body, async () => performCheckout(ctx, course, cohort, body));

  if ("replay" in outcome && outcome.replay) {
    ctx.res.status(outcome.response.status).json(outcome.response.body);
    return;
  }
  await outcome.store({ status: outcome.result.status, body: outcome.result.body });
  ctx.res.status(outcome.result.status).json(outcome.result.body);
}

type CheckoutResult = { status: number; body: unknown };

async function activeCohortCount(client: PoolClient, cohortId: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM enrolments WHERE cohort_id = $1 AND state IN ('held','confirmed','completed','certified')`,
    [cohortId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function performCheckout(
  ctx: Ctx,
  course: NonNullable<Awaited<ReturnType<typeof findCourse>>>,
  cohort: CohortRecord | null,
  body: Record<string, unknown>,
): Promise<CheckoutResult> {
  if (course.state !== "published") throw err(409, "course_not_open");

  const { rows: existing } = await query<{ id: string }>(
    `SELECT id FROM enrolments WHERE nurse_id = $1 AND course_id = $2 AND state IN ('held','confirmed','completed','certified')`,
    [ctx.user.id, course.id],
  );
  if (existing.length > 0) throw err(409, "already_enrolled");

  if (cohort) {
    if (!cohortOpen(cohort.close_date)) throw err(409, "enrolment_closed");
    const { rows: countRows } = await query<{ active: string }>(
      `SELECT count(*)::text AS active FROM enrolments WHERE cohort_id = $1 AND state IN ('held','confirmed','completed','certified')`,
      [cohort.id],
    );
    if (seatsRemaining(cohort.seat_cap, Number(countRows[0]?.active ?? 0)) <= 0) {
      throw err(409, "cohort_full", { waitlist: true });
    }
  }

  const split = await quoteFor(ctx.user.id, course.list_price_cents, ctx.user.organisation_id);
  const quotedCents = parseMoney(body.quoted_learner_share);
  if (quotedCents !== null && quotedCents !== split.learner_share_cents) {
    throw err(409, "quote_changed", { quote: serialiseQuote(split) });
  }

  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!["course_id", "cohort_id", "quoted_learner_share"].includes(key)) errors[key] = "This field is not accepted.";
  }
  if (course.format === "cohort" && cohort === null) errors.cohort_id = "Choose a cohort for this course.";
  if (quotedCents === null) errors.quoted_learner_share = "Refresh the quote and try again.";
  if (Object.keys(errors).length > 0) throw validationError(errors);

  const funding = split.employer_share_cents > 0 ? "co_pay" : "card";

  // 1. Hold the enrolment and claim the seat in one serialisable transaction.
  const enrolmentId = await withSerializable(async (client) => {
    if (cohort) {
      const active = await activeCohortCount(client, cohort.id);
      if (seatsRemaining(cohort.seat_cap, active) <= 0) throw err(409, "cohort_full", { waitlist: true });
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO enrolments (id, nurse_id, course_id, cohort_id, state, funding, hospital_id, list_price_cents, employer_share_cents, learner_share_cents, enrolled_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'held', $4, $5, $6, $7, $8, now()) RETURNING id`,
      [ctx.user.id, course.id, cohort?.id ?? null, funding, funding === "co_pay" ? ctx.user.organisation_id : null, course.list_price_cents, split.employer_share_cents, split.learner_share_cents],
    );
    return rows[0]?.id ?? null;
  });
  if (!enrolmentId) throw new Error("enrolment insert failed");

  // 2. Record the employer payment, then the learner payment.
  try {
    if (split.employer_share_cents > 0 && ctx.user.organisation_id) {
      const { rows } = await query<{ slug: string; name: string }>(`SELECT slug, name FROM organisations WHERE id = $1`, [ctx.user.organisation_id]);
      const hospital = rows[0];
      if (hospital) {
        await purchase(`credwell-hospital-${hospital.slug}`, hospital.name, split.employer_share_cents, `enrol-${enrolmentId}-employer`, ctx.user.id);
      }
    }
    if (split.learner_share_cents > 0) {
      await purchase(`credwell-nurse-${ctx.user.id}`, ctx.user.display_name, split.learner_share_cents, `enrol-${enrolmentId}-learner`, ctx.user.id);
    }
  } catch (e) {
    await rollbackCheckout(enrolmentId, ctx.user.id);
    if (e instanceof PaymentsUnavailable) throw err(503, "payments_unavailable");
    throw e;
  }

  // 3. Confirm the enrolment and queue the receipt in the same transaction.
  await withTransaction(async (client) => {
    await client.query(`UPDATE enrolments SET state = 'confirmed', paid_at = now() WHERE id = $1`, [enrolmentId]);
    await client.query(`INSERT INTO email_outbox (id, to_email, subject, body) VALUES (gen_random_uuid(), $1, $2, $3)`, [
      ctx.user.email,
      `Credwell receipt: ${course.title}`,
      [
        `${ctx.user.display_name},`,
        ``,
        `You're enrolled in "${course.title}"${cohort ? ` (${cohort.name})` : ""}.`,
        `You paid $${centsToMoney(split.learner_share_cents)}.`,
        `Enrolment reference: ${enrolmentId}`,
      ].join("\n"),
    ]);
  });

  const enrolment = await loadEnrolment(enrolmentId);
  if (!enrolment) throw new Error("enrolment missing after confirm");
  return { status: 201, body: { enrolment: serialiseEnrolment(enrolment, await enrolmentModules(enrolmentId)) } };
}

/** Refunds every payment already made for this checkout and releases the hold. */
async function rollbackCheckout(enrolmentId: string, actingUserId: string): Promise<void> {
  for (const side of ["employer", "learner"] as const) {
    const paymentKey = `enrol-${enrolmentId}-${side}`;
    const rollbackKey = `rollback-${enrolmentId}-${side}`;
    try {
      const purchaseInfo = await findPurchase(paymentKey, actingUserId);
      if (!purchaseInfo) continue;
      const already = await transactionExists(rollbackKey, actingUserId);
      if (already) continue;
      await kbRefund(purchaseInfo.paymentId, purchaseInfo.amountCents, rollbackKey, "checkout_rollback", enrolmentId, actingUserId);
    } catch {
      // Kill Bill unreachable mid-rollback: the reservation is released and the
      // external payment stays recorded; approval flows re-check by key.
    }
  }
  await withSerializable(async (client) => {
    await client.query(`DELETE FROM enrolments WHERE id = $1`, [enrolmentId]);
  });
}

export type EnrolmentRecord = EnrolmentRow & { cohort_name: string | null; nurse_id: string };

export async function loadEnrolment(id: string): Promise<EnrolmentRecord | null> {
  const { rows } = await query<EnrolmentRecord>(
    `SELECT e.id, e.nurse_id, e.course_id, c.title AS course_title, e.cohort_id, co.name AS cohort_name, e.state, e.funding,
            e.assignment_id, e.list_price_cents, e.employer_share_cents, e.learner_share_cents, e.enrolled_at,
            COALESCE((SELECT sum(m.minutes) FROM modules m WHERE m.course_id = e.course_id),0)::int AS total_minutes,
            (SELECT cert.id FROM certificates cert WHERE cert.enrolment_id = e.id) AS certificate_id,
            COALESCE((SELECT sum(m.minutes) FROM module_verifications mv
               JOIN modules m ON m.id = mv.module_id
              WHERE mv.enrolment_id = e.id),0)::int AS verified_minutes
       FROM enrolments e
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN cohorts co ON co.id = e.cohort_id
      WHERE e.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function enrolmentModules(enrolmentId: string): Promise<EnrolmentModule[]> {
  const { rows } = await query<{ id: string; title: string; minutes: number; kind: "lesson" | "evaluation"; verified: string }>(
    `SELECT m.id, m.title, m.minutes, m.kind,
            (mv.enrolment_id IS NOT NULL)::text AS verified
       FROM modules m
       JOIN enrolments e ON e.course_id = m.course_id
       LEFT JOIN module_verifications mv ON mv.module_id = m.id AND mv.enrolment_id = e.id
      WHERE e.id = $1 ORDER BY m.position`,
    [enrolmentId],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, minutes: r.minutes, kind: r.kind, status: r.verified === "true" ? "verified" : "unverified" }));
}

export async function getEnrolment(ctx: Ctx): Promise<void> {
  const enrolment = await loadEnrolment(uuidOr404(pathParam(ctx, "id")));
  if (!enrolment) throw notFound();
  const { rows } = await query<{ nurse_id: string; funding: string; hospital_id: string | null }>(
    `SELECT e.nurse_id, e.funding, e.hospital_id FROM enrolments e WHERE e.id = $1`,
    [enrolment.id],
  );
  const access = rows[0];
  if (!access) throw notFound();
  assertEnrolmentReadable(ctx.user, { id: enrolment.id, nurse_id: access.nurse_id, funding: access.funding, hospital_id: access.hospital_id });
  ctx.res.json({ enrolment: serialiseEnrolment(enrolment, await enrolmentModules(enrolment.id)) });
}

export async function listMyEnrolments(ctx: Ctx): Promise<void> {
  const { rows } = await query<{ id: string }>(`SELECT id FROM enrolments WHERE nurse_id = $1 ORDER BY enrolled_at DESC`, [ctx.user.id]);
  const list = [];
  for (const r of rows) {
    const e = await loadEnrolment(r.id);
    if (e) list.push(serialiseEnrolment(e, await enrolmentModules(e.id)));
  }
  ctx.res.json({ enrolments: list });
}
