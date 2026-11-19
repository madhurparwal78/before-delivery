import { randomUUID } from 'node:crypto';
import { isUniqueViolation, oneRow, withTransaction } from '../db/pool.js';
import { apiError, illegalTransition, notFound, validationError } from '../http/errors.js';
import { readInteger, readString, type JsonObject } from '../http/json.js';
import type { ApiResponse, RequestContext } from '../http/router.js';
import {
  closeAllowed,
  cohortRunning,
  publishAllowed,
  refundWindowOpen,
} from '../domain/cohort.js';
import { MESSAGES, isCleanName, type Validated } from '../domain/fields.js';
import { isDateKey } from '../domain/time.js';
import {
  cohortView,
  findCohort,
  findCohortForCoach,
  listCoachCohorts,
  standingOf,
} from '../store/cohorts.js';
import { rosterRowsOf } from '../store/aggregates.js';
import { findEnrollment } from '../store/enrollments.js';
import {
  BillingUnavailableError,
  findPayment,
  makeRefund,
  successfulRefund,
} from '../services/killbill.js';
import { MailUnavailableError, digestMessage, mailOutage, send } from '../services/mail.js';
import { coachOf } from './support.js';

export async function listCohorts(ctx: RequestContext): Promise<ApiResponse> {
  const coach = await coachOf(ctx);
  const cohorts = await listCoachCohorts(coach.id);
  return { status: 200, json: { cohorts: cohorts.map((row) => cohortView(row, ctx.now)) } };
}

interface CohortInput {
  readonly name: string;
  readonly startsOn: string;
  readonly priceCents: number;
  readonly seats: number;
}

function cohortInput(body: JsonObject, name: string | undefined): Validated<CohortInput> {
  const startsOn = readString(body, 'starts_on');
  const priceCents = readInteger(body, 'price_cents');
  const seats = readInteger(body, 'seats');
  const errors: Record<string, string> = {};
  if (name === undefined || !isCleanName(name)) errors['name'] = MESSAGES.cohortName;
  if (startsOn === undefined || !isDateKey(startsOn)) errors['starts_on'] = MESSAGES.startsOn;
  if (priceCents === undefined || priceCents < 100 || priceCents > 100_000) {
    errors['price_cents'] = MESSAGES.priceCents;
  }
  if (seats === undefined || seats < 1 || seats > 50) errors['seats'] = MESSAGES.seats;
  if (
    name === undefined ||
    startsOn === undefined ||
    priceCents === undefined ||
    seats === undefined ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, startsOn, priceCents, seats } };
}

export async function createCohort(ctx: RequestContext): Promise<ApiResponse> {
  const coach = await coachOf(ctx);
  const name = readString(ctx.body, 'name');
  if (name !== undefined) {
    const clash = await oneRow<{ id: string }>(
      'select id from cohorts where coach_id = $1 and lower(name) = lower($2)',
      [coach.id, name],
    );
    if (clash !== null) throw apiError(409, 'cohort_name_taken');
  }

  const input = cohortInput(ctx.body, name);
  if (!input.ok) throw validationError(input.errors);
  const cohort = input.value;

  const id = randomUUID();
  try {
    await oneRow(
      `insert into cohorts (id, coach_id, name, starts_on, price_cents, seats)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [id, coach.id, cohort.name, cohort.startsOn, cohort.priceCents, cohort.seats],
    );
  } catch (error) {
    if (isUniqueViolation(error, 'cohorts_coach_name_key')) {
      throw apiError(409, 'cohort_name_taken');
    }
    throw error;
  }
  const created = await findCohort(id);
  if (created === null) throw notFound();
  return { status: 201, json: { cohort: cohortView(created, ctx.now) } };
}

export async function publishCohort(ctx: RequestContext): Promise<ApiResponse> {
  const coach = await coachOf(ctx);
  const cohort = await findCohortForCoach(ctx.params['id'] ?? '', coach.id);
  if (cohort === null) throw notFound();
  const phase = standingOf(cohort, ctx.now).phase;
  if (!publishAllowed(phase)) throw illegalTransition(phase, 'enrolling');
  await oneRow('update cohorts set published_at = now() where id = $1 returning id', [cohort.id]);
  const updated = await findCohort(cohort.id);
  if (updated === null) throw notFound();
  return { status: 200, json: { cohort: cohortView(updated, ctx.now) } };
}

export async function closeCohort(ctx: RequestContext): Promise<ApiResponse> {
  const coach = await coachOf(ctx);
  const cohort = await findCohortForCoach(ctx.params['id'] ?? '', coach.id);
  if (cohort === null) throw notFound();
  const phase = standingOf(cohort, ctx.now).phase;
  if (!closeAllowed(phase)) throw illegalTransition(phase, 'closed');
  await oneRow('update cohorts set closed_at = now() where id = $1 returning id', [cohort.id]);
  const updated = await findCohort(cohort.id);
  if (updated === null) throw notFound();
  return { status: 200, json: { cohort: cohortView(updated, ctx.now) } };
}

export async function readRoster(ctx: RequestContext): Promise<ApiResponse> {
  const coach = await coachOf(ctx);
  const cohort = await findCohortForCoach(ctx.params['id'] ?? '', coach.id);
  if (cohort === null) throw notFound();
  return {
    status: 200,
    json: {
      cohort: cohortView(cohort, ctx.now),
      dreamers: await rosterRowsOf(cohort.id, ctx.now),
    },
  };
}

export async function sendDigest(ctx: RequestContext): Promise<ApiResponse> {
  const coach = await coachOf(ctx);
  const cohort = await findCohortForCoach(ctx.params['id'] ?? '', coach.id);
  if (cohort === null) throw notFound();

  try {
    return await withTransaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`digest:${cohort.id}`]);
      const standing = standingOf(cohort, ctx.now);
      if (!cohortRunning(standing.phase) || standing.week === null) {
        throw apiError(409, 'cohort_not_running');
      }
      const week = standing.week;
      const stored = await oneRow<{ week: number; to_email: string; dreamers: number }>(
        'select week, to_email, dreamers from digests where cohort_id = $1 and week = $2',
        [cohort.id, week],
        client,
      );
      if (stored !== null) {
        return {
          status: 200,
          json: {
            digest: {
              week: stored.week,
              to: stored.to_email,
              dreamers: stored.dreamers,
              replayed: true,
            },
          },
        };
      }
      const roster = await rosterRowsOf(cohort.id, ctx.now);
      const active = roster.filter((row) => row.status === 'active');
      await send(digestMessage(coach.email, cohort.name, week, active));
      await client.query(
        'insert into digests (cohort_id, week, to_email, dreamers) values ($1, $2, $3, $4)',
        [cohort.id, week, coach.email, active.length],
      );
      return {
        status: 200,
        json: {
          digest: { week, to: coach.email, dreamers: active.length, replayed: false },
        },
      };
    });
  } catch (error) {
    if (error instanceof MailUnavailableError) throw mailOutage();
    throw error;
  }
}

export async function refundSeat(ctx: RequestContext): Promise<ApiResponse> {
  const coach = await coachOf(ctx);
  const enrollmentId = ctx.params['id'] ?? '';
  const owned = await oneRow<{ id: string }>(
    `select e.id from enrollments e
       join cohorts c on c.id = e.cohort_id
      where e.id = $1 and c.coach_id = $2`,
    [enrollmentId, coach.id],
  );
  if (owned === null) throw notFound();

  let cohortId: string;
  try {
    cohortId = await withTransaction(async (client) => {
      const locked = await oneRow<{ id: string; status: string; cohort_id: string }>(
        'select id, status, cohort_id from enrollments where id = $1 for update',
        [enrollmentId],
        client,
      );
      if (locked === null) throw notFound();
      if (locked.status !== 'active') throw illegalTransition(locked.status, 'refunded');
      const cohort = await findCohort(locked.cohort_id, client);
      if (cohort === null) throw notFound();
      if (!refundWindowOpen(standingOf(cohort, ctx.now).phase)) {
        throw apiError(409, 'refund_window_closed');
      }
      const enrollment = await findEnrollment(enrollmentId, client);
      if (enrollment === null) throw notFound();
      if (enrollment.paid_amount_cents === null) throw apiError(409, 'not_refundable');

      const payment = await findPayment(enrollment.id);
      let refund = successfulRefund(payment, enrollment.id);
      if (refund === null) {
        if (payment === null) {
          throw new BillingUnavailableError('No payment is recorded for this enrollment');
        }
        refund = successfulRefund(
          await makeRefund(payment.paymentId, enrollment.id, enrollment.paid_amount_cents),
          enrollment.id,
        );
        if (refund === null) throw new BillingUnavailableError('The refund did not succeed');
      }

      await client.query("update enrollments set status = 'refunded' where id = $1", [
        enrollment.id,
      ]);
      await client.query('delete from sessions where enrollment_id = $1', [enrollment.id]);
      return cohort.id;
    });
  } catch (error) {
    if (error instanceof BillingUnavailableError) throw apiError(503, 'billing_unavailable');
    throw error;
  }

  const roster = await rosterRowsOf(cohortId, ctx.now);
  const dreamer = roster.find((row) => row.enrollment_id === enrollmentId);
  if (dreamer === undefined) throw notFound();
  return { status: 200, json: { dreamer } };
}
