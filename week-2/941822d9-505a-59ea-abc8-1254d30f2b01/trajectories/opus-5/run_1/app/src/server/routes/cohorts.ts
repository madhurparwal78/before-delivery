import { one, pool, withSerializable, withTransaction } from '../db/pool.js';
import {
  activeEnrolmentCount,
  cohortJson,
  getCohort,
  getCohortForUpdate,
  isOpen,
  waitlistPosition,
} from '../data/cohorts.js';
import { canReadCourse, getCourse } from '../data/courses.js';
import { ACTIVE_ENROLMENT_STATES } from '../domain/enrolment.js';
import { isOpenForEnrolment } from '../domain/courseLifecycle.js';
import { parseDateOnly } from '../domain/providerTime.js';
import { conflict, forbidden, notFound, Validator } from '../http/errors.js';
import { param, requireUser, type Reply, type RequestContext } from '../http/context.js';
import type { Route } from '../http/router.js';
import { newId } from '../util/ids.js';

const SEAT_CAP_MESSAGE = 'Seat cap must be a whole number from 1 to 500.';
const CLOSE_DATE_MESSAGE = 'Enrolment must close on or before the start date.';
const NAME_MESSAGE = 'Enter a cohort name of 1 to 80 characters.';
const STARTS_ON_MESSAGE = 'Enter a start date as YYYY-MM-DD.';

function readSeatCap(raw: unknown, validator: Validator): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 500) {
    validator.add('seat_cap', SEAT_CAP_MESSAGE);
    return null;
  }
  return raw;
}

async function createCohort(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const course = await getCourse(pool, param(ctx, 'id'));
  if (course === null || !canReadCourse(course, user)) throw notFound();
  if (user.role !== 'planner') throw forbidden();
  if (course.format !== 'cohort' || !isOpenForEnrolment(course.state)) throw conflict('course_not_open');

  const validator = new Validator(ctx.body, ['name', 'seat_cap', 'starts_on', 'close_date']);
  const body = ctx.body ?? {};
  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  if (name.length === 0 || name.length > 80) validator.add('name', NAME_MESSAGE);
  const seatCap = readSeatCap(body['seat_cap'], validator);
  const startsOn = parseDateOnly(body['starts_on']);
  if (startsOn === null) validator.add('starts_on', STARTS_ON_MESSAGE);
  const closeDate = parseDateOnly(body['close_date']);
  if (closeDate === null) validator.add('close_date', CLOSE_DATE_MESSAGE);
  else if (typeof body['starts_on'] === 'string' && typeof body['close_date'] === 'string' && startsOn !== null) {
    if (body['close_date'] > body['starts_on']) validator.add('close_date', CLOSE_DATE_MESSAGE);
  }
  validator.throwIfInvalid();
  if (seatCap === null) throw new Error('A validated seat cap is a number');

  const json = await withTransaction(async (client) => {
    const cohortId = newId();
    await client.query(
      `INSERT INTO cohorts (id, course_id, name, seat_cap, starts_on, close_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [cohortId, course.id, name, seatCap, body['starts_on'], body['close_date']],
    );
    const created = await getCohort(client, cohortId);
    if (created === null) throw new Error('The new cohort was not written');
    return cohortJson(client, created, true, ctx.at);
  });
  return { status: 201, json: { cohort: json } };
}

async function readCohort(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const cohort = await getCohort(pool, param(ctx, 'id'));
  if (cohort === null) throw notFound();
  const course = await getCourse(pool, cohort.course_id);
  if (course === null || !canReadCourse(course, user)) throw notFound();
  return {
    status: 200,
    json: { cohort: await cohortJson(pool, cohort, user.role === 'planner', ctx.at) },
  };
}

async function patchCohort(ctx: RequestContext): Promise<Reply> {
  const cohort = await getCohort(pool, param(ctx, 'id'));
  if (cohort === null) throw notFound();

  const json = await withTransaction(async (client) => {
    const locked = await getCohortForUpdate(client, cohort.id);
    if (locked === null) throw notFound();
    const validator = new Validator(ctx.body, ['seat_cap']);
    const seatCap = readSeatCap(ctx.body?.['seat_cap'], validator);
    if (seatCap !== null) {
      const enrolled = await activeEnrolmentCount(client, locked.id);
      if (seatCap < enrolled) throw conflict('cap_below_enrolled');
    }
    validator.throwIfInvalid();
    if (seatCap === null) throw new Error('A validated seat cap is a number');
    await client.query('UPDATE cohorts SET seat_cap = $2 WHERE id = $1', [locked.id, seatCap]);
    const updated = await getCohort(client, locked.id);
    if (updated === null) throw new Error('The cohort vanished mid-save');
    return cohortJson(client, updated, true, ctx.at);
  });
  return { status: 200, json: { cohort: json } };
}

/** Joining is allowed only while the cohort is open and seats remaining is zero. */
async function joinWaitlist(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const cohort = await getCohort(pool, param(ctx, 'id'));
  if (cohort === null) throw notFound();
  const course = await getCourse(pool, cohort.course_id);
  if (course === null || !canReadCourse(course, user)) throw notFound();

  const existing = await waitlistPosition(pool, cohort.id, user.id);
  if (existing !== null) {
    return { status: 200, json: { waitlist_entry: existing } };
  }

  const entry = await withSerializable(async (client) => {
    const alreadyEnrolled = await one<{ id: string }>(
      client,
      `SELECT id FROM enrolments WHERE user_id = $1 AND course_id = $2 AND state = ANY($3)`,
      [user.id, course.id, ACTIVE_ENROLMENT_STATES],
    );
    if (alreadyEnrolled !== null) throw conflict('already_enrolled');
    if (!isOpen(cohort, ctx.at)) throw conflict('enrolment_closed');
    const taken = await activeEnrolmentCount(client, cohort.id);
    if (cohort.seat_cap - taken > 0) throw conflict('seats_available');
    new Validator(ctx.body, []).throwIfInvalid();
    await client.query('INSERT INTO waitlist_entries (id, cohort_id, user_id) VALUES ($1, $2, $3)', [
      newId(),
      cohort.id,
      user.id,
    ]);
    const position = await waitlistPosition(client, cohort.id, user.id);
    if (position === null) throw new Error('The waitlist entry was not written');
    return position;
  });
  return { status: 201, json: { waitlist_entry: entry } };
}

async function leaveWaitlist(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const cohort = await getCohort(pool, param(ctx, 'id'));
  if (cohort === null) throw notFound();
  if ((await waitlistPosition(pool, cohort.id, user.id)) === null) throw notFound();
  new Validator(ctx.body, []).throwIfInvalid();
  await pool.query('DELETE FROM waitlist_entries WHERE cohort_id = $1 AND user_id = $2', [cohort.id, user.id]);
  return { status: 204 };
}

export const cohortRoutes: readonly Route[] = [
  { method: 'POST', path: '/api/courses/:id/cohorts', auth: 'required', handler: createCohort },
  { method: 'GET', path: '/api/cohorts/:id', auth: 'required', handler: readCohort },
  { method: 'PATCH', path: '/api/cohorts/:id', auth: 'required', roles: ['planner'], handler: patchCohort },
  { method: 'POST', path: '/api/cohorts/:id/waitlist', auth: 'required', roles: ['learner'], handler: joinWaitlist },
  { method: 'DELETE', path: '/api/cohorts/:id/waitlist', auth: 'required', roles: ['learner'], handler: leaveWaitlist },
];
