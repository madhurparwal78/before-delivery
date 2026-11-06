import { randomUUID } from "node:crypto";
import { claimRow, db, isUniqueViolation, one, tx, type Db } from "../db.js";
import { conflict, forbidden, notFound, Validation } from "../http/errors.js";
import type { Reply, SignedInCtx } from "../http/router.js";
import { payerAccountId, purchase, refundOnce } from "../services/killbill.js";
import { formatMoney, parseMoney } from "./amounts.js";
import { COHORT_COLUMNS, isOpen, seatsRemaining, seatsTaken, type CohortRow } from "./cohorts.js";
import { isId, readableCourse, type CourseRow } from "./courses.js";
import { quoteFor, quoteJson, type Quote } from "./coverage.js";
import { enrolmentJson, OPEN_ENROLMENT } from "./enrolments.js";
import { idempotencyKey, idempotent } from "./idempotency.js";
import { nudgeOutbox, queueMail } from "./outbox.js";
import type { SessionUser } from "./users.js";

export async function cohortRow(t: Db, id: unknown): Promise<CohortRow | undefined> {
  if (!isId(id)) return undefined;
  return one<CohortRow>(t, `SELECT ${COHORT_COLUMNS} FROM cohorts WHERE id = $1`, [id]);
}

export const hasOpenEnrolment = async (t: Db, learnerId: string, courseId: string): Promise<boolean> =>
  (await one(t, `SELECT 1 FROM enrolments e WHERE e.learner_id = $1 AND e.course_id = $2 AND ${OPEN_ENROLMENT}`, [learnerId, courseId])) !== undefined;

export async function quoteReply(ctx: SignedInCtx): Promise<Reply> {
  const course = await readableCourse(db, ctx.user, ctx.query.get("course_id"));
  if (ctx.user.role !== "learner") throw forbidden();
  return { status: 200, json: quoteJson(await quoteFor(db, ctx.user, course.list_price_cents, ctx.now)) };
}

const payers = (nurse: SessionUser, quote: Quote) => ({
  employer: quote.sponsor && nurse.organisation ? { externalKey: `credwell-hospital-${nurse.organisation.slug}`, name: quote.sponsor.name, email: null } : null,
  learner: { externalKey: `credwell-nurse-${nurse.id}`, name: nurse.display_name, email: nurse.email },
});

/** Step 1: hold the enrolment (and claim the cohort seat) in one serialisable transaction. */
async function hold(nurse: SessionUser, course: CourseRow, cohort: CohortRow | null, quote: Quote, enrolmentId: string, now: Date): Promise<void> {
  await tx(async (t) => {
    if (cohort) {
      await claimRow(t, "cohorts", cohort.id);
      const current = await cohortRow(t, cohort.id);
      if (!current || seatsRemaining(current, await seatsTaken(t, [current.id])) <= 0) throw conflict("cohort_full", { waitlist: true });
    }
    try {
      await t.q(
        `INSERT INTO enrolments (id, learner_id, course_id, cohort_id, state, funding, funding_hospital_id, list_price_cents,
                                 employer_share_cents, learner_share_cents, enrolled_at)
         VALUES ($1, $2, $3, $4, 'held', $5, $6, $7, $8, $9, $10)`,
        [
          enrolmentId,
          nurse.id,
          course.id,
          cohort?.id ?? null,
          quote.funding,
          quote.funding === "card" ? null : (quote.sponsor?.id ?? null),
          quote.listPriceCents,
          quote.employerCents,
          quote.learnerCents,
          now,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("already_enrolled");
      throw error;
    }
  });
}

/** Step 2: the employer then the learner payment; on any failure every payment made is refunded and the hold released. */
async function pay(nurse: SessionUser, quote: Quote, enrolmentId: string): Promise<void> {
  const accounts = payers(nurse, quote);
  const paid: { side: "employer" | "learner"; cents: number }[] = [];
  try {
    if (quote.employerCents > 0 && accounts.employer) {
      await purchase(await payerAccountId(accounts.employer, nurse.id), `enrol-${enrolmentId}-employer`, quote.employerCents, nurse.id);
      paid.push({ side: "employer", cents: quote.employerCents });
    }
    if (quote.learnerCents > 0) {
      await purchase(await payerAccountId(accounts.learner, nurse.id), `enrol-${enrolmentId}-learner`, quote.learnerCents, nurse.id);
      paid.push({ side: "learner", cents: quote.learnerCents });
    }
  } catch (error) {
    for (const { side, cents } of paid) {
      await refundOnce(`enrol-${enrolmentId}-${side}`, `rollback-${enrolmentId}-${side}`, cents, {
        actor: nurse.id,
        reason: "checkout_rollback",
        comment: enrolmentId,
      }).catch((rollbackError: unknown) => console.error(`checkout rollback ${enrolmentId}-${side} failed:`, rollbackError));
    }
    await db.q("DELETE FROM enrolments WHERE id = $1 AND state = 'held'", [enrolmentId]);
    throw error;
  }
}

/** Step 3: confirm the enrolment, leave the cohort's waitlist and queue the receipt in one transaction. */
async function confirmEnrolment(nurse: SessionUser, course: CourseRow, cohort: CohortRow | null, quote: Quote, enrolmentId: string, now: Date): Promise<void> {
  await tx(async (t) => {
    await t.q("UPDATE enrolments SET state = 'confirmed' WHERE id = $1", [enrolmentId]);
    if (cohort) await t.q("DELETE FROM waitlist_entries WHERE cohort_id = $1 AND learner_id = $2", [cohort.id, nurse.id]);
    const lines = [
      `Hello ${nurse.display_name},`,
      "",
      "Thank you for enrolling with Sorrel & Pike Learning. This is your receipt.",
      "",
      `Course: ${course.title}`,
      ...(cohort ? [`Cohort: ${cohort.name}`] : []),
      `You paid $${formatMoney(quote.learnerCents)}`,
      `Enrolment: ${enrolmentId}`,
    ];
    await queueMail(t, { eventKey: `receipt:${enrolmentId}`, to: nurse.email, subject: `Credwell receipt: ${course.title}`, text: lines.join("\n") }, now);
  });
  nudgeOutbox();
}

export async function checkout(ctx: SignedInCtx): Promise<Reply> {
  const { user: nurse, body, now } = ctx;
  const course = await readableCourse(db, nurse, body.course_id);
  let cohort: CohortRow | null = null;
  if (body.cohort_id !== undefined && body.cohort_id !== null) {
    const found = await cohortRow(db, body.cohort_id);
    if (!found || found.course_id !== course.id) throw notFound();
    cohort = found;
  }
  if (nurse.role !== "learner") throw forbidden();
  const key = idempotencyKey(ctx.headers);
  return idempotent(nurse.id, key, body, now, async () => {
    if (course.state === "withdrawn") throw conflict("course_not_open");
    if (await hasOpenEnrolment(db, nurse.id, course.id)) throw conflict("already_enrolled");
    if (cohort) {
      if (!isOpen(cohort, now)) throw conflict("enrolment_closed");
      if (seatsRemaining(cohort, await seatsTaken(db, [cohort.id])) <= 0) throw conflict("cohort_full", { waitlist: true });
    }
    const quote = await quoteFor(db, nurse, course.list_price_cents, now);
    const quoted = parseMoney(body.quoted_learner_share);
    if (quoted !== null && quoted !== quote.learnerCents) throw conflict("quote_changed", { quote: quoteJson(quote) });
    const v = new Validation(body, ["course_id", "cohort_id", "quoted_learner_share"]);
    if (course.format === "cohort" && cohort === null) v.add("cohort_id", "Choose a cohort for this course.");
    if (quoted === null) v.add("quoted_learner_share", "Refresh the quote and try again.");
    v.done();

    const enrolmentId = randomUUID();
    await hold(nurse, course, cohort, quote, enrolmentId, now);
    await pay(nurse, quote, enrolmentId);
    await confirmEnrolment(nurse, course, cohort, quote, enrolmentId, now);
    return { status: 201, json: { enrolment: await enrolmentJson(db, enrolmentId) } };
  });
}
