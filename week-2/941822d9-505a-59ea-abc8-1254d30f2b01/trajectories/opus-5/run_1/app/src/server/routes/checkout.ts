import { one, pool, withSerializable, withTransaction } from '../db/pool.js';
import { activeEnrolmentCount, getCohort, isOpen } from '../data/cohorts.js';
import { canReadCourse, getCourse, type CourseRow } from '../data/courses.js';
import { quoteForLearner } from '../data/coverage.js';
import { enrolmentJson, getEnrolment } from '../data/enrolments.js';
import { runIdempotent, readIdempotencyKey } from '../data/idempotency.js';
import { queueEmail } from '../data/outbox.js';
import { isOpenForEnrolment } from '../domain/courseLifecycle.js';
import { fundingForShares, type Shares } from '../domain/coverage.js';
import { ACTIVE_ENROLMENT_STATES } from '../domain/enrolment.js';
import { formatMoney, parseMoney } from '../domain/money.js';
import { conflict, notFound, Validator } from '../http/errors.js';
import { requireUser, type AuthUser, type Reply, type RequestContext } from '../http/context.js';
import type { Route } from '../http/router.js';
import {
  ensureAccount,
  hospitalAccountExternalKey,
  nurseAccountExternalKey,
  purchase,
  refundOnce,
} from '../services/killbill.js';
import { enrolmentReceipt } from '../services/emails.js';
import { newId } from '../util/ids.js';

const COHORT_REQUIRED_MESSAGE = 'Choose a cohort for this course.';
const QUOTE_MESSAGE = 'Refresh the quote and try again.';

async function readableCourse(ctx: RequestContext, courseId: unknown): Promise<CourseRow> {
  const user = requireUser(ctx);
  if (typeof courseId !== 'string') throw notFound();
  const course = await getCourse(pool, courseId);
  if (course === null || !canReadCourse(course, user)) throw notFound();
  return course;
}

/** A cohort id that is unknown or belongs to another course is a not-found. */
async function cohortOfCourse(
  cohortId: unknown,
  course: CourseRow,
): Promise<Awaited<ReturnType<typeof getCohort>>> {
  if (cohortId === undefined || cohortId === null) return null;
  if (typeof cohortId !== 'string') throw notFound();
  const cohort = await getCohort(pool, cohortId);
  if (cohort === null || cohort.course_id !== course.id) throw notFound();
  return cohort;
}

async function readQuote(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const course = await readableCourse(ctx, ctx.query.get('course_id'));
  const { json } = await quoteForLearner(
    pool,
    user.organisationId,
    user.organisationName,
    course.list_price_cents,
    ctx.at,
  );
  return { status: 200, json };
}

interface PaymentRecord {
  readonly party: 'learner' | 'employer';
  readonly killbillPaymentId: string;
  readonly amountCents: number;
}

/** Records the employer payment then the learner payment, each only if non-zero. */
async function recordPayments(
  enrolmentId: string,
  shares: Shares,
  learner: AuthUser,
): Promise<PaymentRecord[]> {
  const made: PaymentRecord[] = [];
  if (shares.employerShareCents > 0) {
    if (learner.organisationId === null || learner.organisationSlug === null || learner.organisationName === null) {
      throw new Error('An employer share needs an employer');
    }
    const accountId = await ensureAccount(
      hospitalAccountExternalKey(learner.organisationSlug),
      learner.organisationName,
      learner.id,
    );
    const paymentId = await purchase({
      accountId,
      amountCents: shares.employerShareCents,
      paymentExternalKey: `enrol-${enrolmentId}-employer`,
      actingUserId: learner.id,
    });
    made.push({ party: 'employer', killbillPaymentId: paymentId, amountCents: shares.employerShareCents });
    await pool.query(
      `INSERT INTO payments (id, enrolment_id, party, external_key, killbill_payment_id, amount_cents)
       VALUES ($1, $2, 'employer', $3, $4, $5)`,
      [newId(), enrolmentId, `enrol-${enrolmentId}-employer`, paymentId, shares.employerShareCents],
    );
  }
  if (shares.learnerShareCents > 0) {
    const accountId = await ensureAccount(
      nurseAccountExternalKey(learner.id),
      learner.displayName,
      learner.id,
    );
    const paymentId = await purchase({
      accountId,
      amountCents: shares.learnerShareCents,
      paymentExternalKey: `enrol-${enrolmentId}-learner`,
      actingUserId: learner.id,
    });
    made.push({ party: 'learner', killbillPaymentId: paymentId, amountCents: shares.learnerShareCents });
    await pool.query(
      `INSERT INTO payments (id, enrolment_id, party, external_key, killbill_payment_id, amount_cents)
       VALUES ($1, $2, 'learner', $3, $4, $5)`,
      [newId(), enrolmentId, `enrol-${enrolmentId}-learner`, paymentId, shares.learnerShareCents],
    );
  }
  return made;
}

/** Every payment already made for this checkout is refunded in full and the hold released. */
async function rollbackCheckout(
  enrolmentId: string,
  made: readonly PaymentRecord[],
  learner: AuthUser,
): Promise<void> {
  for (const payment of made) {
    await refundOnce({
      paymentId: payment.killbillPaymentId,
      amountCents: payment.amountCents,
      transactionExternalKey: `rollback-${enrolmentId}-${payment.party}`,
      reasonCode: 'checkout_rollback',
      comment: enrolmentId,
      actingUserId: learner.id,
    });
  }
  await pool.query('DELETE FROM enrolments WHERE id = $1', [enrolmentId]);
}

async function runCheckout(ctx: RequestContext): Promise<Reply> {
  const learner = requireUser(ctx);
  const body = ctx.body ?? {};
  const course = await readableCourse(ctx, body['course_id']);

  const cohort = await cohortOfCourse(body['cohort_id'], course);
  const key = readIdempotencyKey(ctx.request.headers['idempotency-key']);

  return runIdempotent(learner.id, key, ctx.body, async () => {
    if (!isOpenForEnrolment(course.state)) throw conflict('course_not_open');
    const live = await one<{ id: string }>(
      pool,
      `SELECT id FROM enrolments WHERE user_id = $1 AND course_id = $2 AND state = ANY($3)`,
      [learner.id, course.id, ACTIVE_ENROLMENT_STATES],
    );
    if (live !== null) throw conflict('already_enrolled');
    if (cohort !== null) {
      if (!isOpen(cohort, ctx.at)) throw conflict('enrolment_closed');
      const taken = await activeEnrolmentCount(pool, cohort.id);
      if (cohort.seat_cap - taken <= 0) throw conflict('cohort_full', { waitlist: true });
    }

    const { shares, json: quote } = await quoteForLearner(
      pool,
      learner.organisationId,
      learner.organisationName,
      course.list_price_cents,
      ctx.at,
    );
    const quoted = parseMoney(body['quoted_learner_share']);
    if (quoted !== null && quoted !== shares.learnerShareCents) {
      throw conflict('quote_changed', { quote });
    }

    const validator = new Validator(ctx.body, ['course_id', 'cohort_id', 'quoted_learner_share']);
    if (course.format === 'cohort' && cohort === null) validator.add('cohort_id', COHORT_REQUIRED_MESSAGE);
    if (quoted === null) validator.add('quoted_learner_share', QUOTE_MESSAGE);
    validator.throwIfInvalid();

    const funding = fundingForShares(shares.employerShareCents);
    const sponsorOrganisationId = shares.employerShareCents > 0 ? learner.organisationId : null;

    const enrolmentId = await withSerializable(async (client) => {
      if (cohort !== null) {
        const taken = await activeEnrolmentCount(client, cohort.id);
        if (cohort.seat_cap - taken <= 0) throw conflict('cohort_full', { waitlist: true });
      }
      const id = newId();
      const inserted = await client.query(
        `INSERT INTO enrolments
           (id, user_id, course_id, cohort_id, state, funding, sponsor_organisation_id,
            list_price_cents, employer_share_cents, learner_share_cents)
         VALUES ($1, $2, $3, $4, 'held', $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          id,
          learner.id,
          course.id,
          cohort?.id ?? null,
          funding,
          sponsorOrganisationId,
          shares.listPriceCents,
          shares.employerShareCents,
          shares.learnerShareCents,
        ],
      );
      if (inserted.rowCount === 0) throw conflict('already_enrolled');
      return id;
    });

    let made: PaymentRecord[] = [];
    try {
      made = await recordPayments(enrolmentId, shares, learner);
    } catch (error) {
      await rollbackCheckout(enrolmentId, made, learner);
      throw error;
    }

    const json = await withTransaction(async (client) => {
      await client.query(`UPDATE enrolments SET state = 'confirmed' WHERE id = $1`, [enrolmentId]);
      if (cohort !== null) {
        await client.query('DELETE FROM waitlist_entries WHERE cohort_id = $1 AND user_id = $2', [
          cohort.id,
          learner.id,
        ]);
      }
      await queueEmail(
        client,
        enrolmentReceipt({
          to: learner.email,
          nurseName: learner.displayName,
          courseTitle: course.title,
          cohortName: cohort?.name ?? null,
          learnerShare: formatMoney(shares.learnerShareCents),
          enrolmentId,
        }),
      );
      const enrolment = await getEnrolment(client, enrolmentId);
      if (enrolment === null) throw new Error('The new enrolment vanished');
      return enrolmentJson(client, enrolment);
    });
    return { status: 201, json: { enrolment: json } };
  });
}

export const checkoutRoutes: readonly Route[] = [
  { method: 'GET', path: '/api/checkout/quote', auth: 'required', roles: ['learner'], handler: readQuote },
  { method: 'POST', path: '/api/checkout', auth: 'required', roles: ['learner'], handler: runCheckout },
];
