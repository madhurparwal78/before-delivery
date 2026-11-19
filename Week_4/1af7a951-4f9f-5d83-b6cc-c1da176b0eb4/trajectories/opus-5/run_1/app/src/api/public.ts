import { randomUUID } from 'node:crypto';
import { oneRow, withTransaction } from '../db/pool.js';
import { apiError, illegalTransition, notFound, validationError } from '../http/errors.js';
import { readString, type JsonObject } from '../http/json.js';
import { isUuid, type ApiResponse, type RequestContext } from '../http/router.js';
import { enrollmentOpen, seatsLeft } from '../domain/cohort.js';
import {
  MESSAGES,
  isBedtime,
  isCleanName,
  isEmailAddress,
  type Validated,
} from '../domain/fields.js';
import { publishedNightKey } from '../domain/night.js';
import { acceptedTimeZones, isAcceptedTimeZone } from '../domain/time.js';
import {
  cohortView,
  findCohort,
  listAllCohorts,
  standingOf,
  type CohortRow,
} from '../store/cohorts.js';
import {
  enrollmentView,
  findEnrollment,
  findEnrollmentByEmail,
  latestStoredNightKey,
  newAccessCode,
  type EnrollmentRow,
} from '../store/enrollments.js';
import {
  BillingUnavailableError,
  ensureAccount,
  findPayment,
  makePurchase,
  successfulPurchase,
} from '../services/killbill.js';
import { deliverReceipt } from './receipts.js';

export async function health(): Promise<ApiResponse> {
  return { status: 200, json: { status: 'ok' } };
}

export async function timeZones(): Promise<ApiResponse> {
  return { status: 200, json: { zones: acceptedTimeZones() } };
}

export async function listOpenCohorts(ctx: RequestContext): Promise<ApiResponse> {
  const all = await listAllCohorts();
  const open = all
    .map((row) => cohortView(row, ctx.now))
    .filter((view) => view.phase === 'enrolling' || view.phase === 'baseline');
  return { status: 200, json: { cohorts: open } };
}

async function publishedCohortOr404(id: string, now: Date): Promise<CohortRow> {
  if (!isUuid(id)) throw notFound();
  const cohort = await findCohort(id);
  if (cohort === null) throw notFound();
  if (standingOf(cohort, now).phase === 'draft') throw notFound();
  return cohort;
}

export async function readCohort(ctx: RequestContext): Promise<ApiResponse> {
  const cohort = await publishedCohortOr404(ctx.params['id'] ?? '', ctx.now);
  return { status: 200, json: { cohort: cohortView(cohort, ctx.now) } };
}

interface EnrollmentInput {
  readonly name: string;
  readonly email: string;
  readonly homeTz: string;
  readonly bedtime: string;
}

function enrollmentInput(body: JsonObject): Validated<EnrollmentInput> {
  const name = readString(body, 'name');
  const email = readString(body, 'email');
  const homeTz = readString(body, 'home_tz');
  const bedtime = readString(body, 'bedtime');
  const errors: Record<string, string> = {};
  if (name === undefined || !isCleanName(name)) errors['name'] = MESSAGES.applicantName;
  if (email === undefined || !isEmailAddress(email)) errors['email'] = MESSAGES.email;
  if (homeTz === undefined || !isAcceptedTimeZone(homeTz)) errors['home_tz'] = MESSAGES.homeTz;
  if (bedtime === undefined || !isBedtime(bedtime)) errors['bedtime'] = MESSAGES.bedtime;
  if (
    name === undefined ||
    email === undefined ||
    homeTz === undefined ||
    bedtime === undefined ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, email, homeTz, bedtime } };
}

export async function createEnrollment(ctx: RequestContext): Promise<ApiResponse> {
  const cohortId = readString(ctx.body, 'cohort_id') ?? '';
  const cohort = await publishedCohortOr404(cohortId, ctx.now);

  const phase = standingOf(cohort, ctx.now).phase;
  if (!enrollmentOpen(phase)) throw apiError(409, 'enrollment_closed');

  const email = readString(ctx.body, 'email');
  if (email !== undefined && (await findEnrollmentByEmail(cohort.id, email)) !== null) {
    throw apiError(409, 'already_enrolled');
  }

  const input = enrollmentInput(ctx.body);
  if (!input.ok) throw validationError(input.errors);
  const { name, email: address, homeTz, bedtime } = input.value;

  const id = randomUUID();
  const accessCode = newAccessCode();
  await oneRow(
    `insert into enrollments (id, cohort_id, name, email, status, home_tz, bedtime, access_code)
     values ($1, $2, $3, $4, 'pending_payment', $5, $6, $7) returning id`,
    [id, cohort.id, name, address, homeTz, bedtime, accessCode],
  );
  const stored = await findEnrollment(id);
  if (stored === null) throw notFound();
  return {
    status: 201,
    json: { enrollment: enrollmentView(stored), access_code: accessCode },
  };
}

export async function readEnrollment(ctx: RequestContext): Promise<ApiResponse> {
  const enrollment = await findEnrollment(ctx.params['id'] ?? '');
  if (enrollment === null) throw notFound();
  return { status: 200, json: { enrollment: enrollmentView(enrollment) } };
}

interface PayOutcome {
  readonly enrollment: EnrollmentRow;
  readonly activated: boolean;
  readonly accessCode: string;
  readonly amountPaidCents: number;
}

export async function payEnrollment(ctx: RequestContext): Promise<ApiResponse> {
  const enrollmentId = ctx.params['id'] ?? '';
  const existing = await findEnrollment(enrollmentId);
  if (existing === null) throw notFound();

  let outcome: PayOutcome;
  try {
    outcome = await withTransaction(async (client) => {
      await client.query('select id from cohorts where id = $1 for update', [existing.cohort_id]);
      const enrollment = await findEnrollment(enrollmentId, client);
      if (enrollment === null) throw notFound();
      if (enrollment.status === 'active') {
        return {
          enrollment,
          activated: false,
          accessCode: enrollment.access_code,
          amountPaidCents: enrollment.paid_amount_cents ?? enrollment.price_cents,
        };
      }
      if (enrollment.status === 'refunded') throw illegalTransition('refunded', 'active');

      const cohort = await findCohort(enrollment.cohort_id, client);
      if (cohort === null) throw notFound();
      if (!enrollmentOpen(standingOf(cohort, ctx.now).phase)) {
        throw apiError(409, 'enrollment_closed');
      }
      if (seatsLeft(cohort.seats, cohort.active_enrollments) <= 0) {
        throw apiError(409, 'cohort_full');
      }

      const accountId = await ensureAccount(enrollment.id, enrollment.name, enrollment.email);
      let purchase = successfulPurchase(await findPayment(enrollment.id));
      if (purchase === null) {
        purchase = successfulPurchase(
          await makePurchase(accountId, enrollment.id, cohort.price_cents),
        );
      }
      if (purchase === null) throw apiError(402, 'payment_declined');

      const derivedNight = publishedNightKey(
        { homeTz: enrollment.home_tz, bedtime: enrollment.bedtime },
        ctx.now,
        await latestStoredNightKey(enrollment.id, client),
      );
      const firstNight = derivedNight > cohort.starts_on ? derivedNight : cohort.starts_on;
      const amountPaidCents = Math.round(purchase.amount * 100);
      await client.query(
        `update enrollments
            set status = 'active', first_night = $2, receipt_status = 'pending', paid_amount_cents = $3
          where id = $1`,
        [enrollment.id, firstNight, amountPaidCents],
      );
      const activated = await findEnrollment(enrollment.id, client);
      if (activated === null) throw notFound();
      return {
        enrollment: activated,
        activated: true,
        accessCode: activated.access_code,
        amountPaidCents,
      };
    });
  } catch (error) {
    if (error instanceof BillingUnavailableError) throw apiError(503, 'billing_unavailable');
    throw error;
  }

  if (outcome.activated) await deliverReceipt(outcome.enrollment.id);
  const fresh = await findEnrollment(outcome.enrollment.id);
  return { status: 200, json: { enrollment: enrollmentView(fresh ?? outcome.enrollment) } };
}
