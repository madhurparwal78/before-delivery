import { one, pool, query, withSerializable, withTransaction } from '../db/pool.js';
import { canReadCourse, getCourse, type CourseRow } from '../data/courses.js';
import { coverageJson, saveCoverage } from '../data/coverage.js';
import { certificateJsonById, type CertificateRow } from '../data/certificates.js';
import { enrolmentJson, getEnrolment, verifiedMinutes } from '../data/enrolments.js';
import { readIdempotencyKey, runIdempotent } from '../data/idempotency.js';
import { queueEmail } from '../data/outbox.js';
import {
  getPack,
  ledgerJson,
  listPacks,
  packBalance,
  packExpiresAt,
  packJson,
  postMovement,
  settleExpiryForOrganisation,
  settlePackExpiry,
} from '../data/packs.js';
import {
  monthlyReport,
  sealedCertificatesForHospital,
  searchLearners,
  sponsorTotals,
} from '../data/sponsor.js';
import { exportObjectKey } from '../domain/certificate.js';
import { isOpenForEnrolment } from '../domain/courseLifecycle.js';
import { csvDocument } from '../domain/csv.js';
import { ACTIVE_ENROLMENT_STATES } from '../domain/enrolment.js';
import { hasExpired } from '../domain/expiry.js';
import { formatHours } from '../domain/contactHours.js';
import { parsePercent } from '../domain/money.js';
import { inclusiveDaySpan, parseDateOnly, providerToday } from '../domain/providerTime.js';
import { conflict, notFound, Validator } from '../http/errors.js';
import { param, requireUser, type AuthUser, type Reply, type RequestContext } from '../http/context.js';
import type { Route } from '../http/router.js';
import { seatInvitation } from '../services/emails.js';
import {
  ensureAccount,
  hospitalAccountExternalKey,
  purchase,
} from '../services/killbill.js';
import { getObject, putObject } from '../services/storage.js';
import { newId } from '../util/ids.js';

const PERCENT_MESSAGE = 'Enter a percentage from 0 to 100 with at most two decimals.';
const EFFECTIVE_MESSAGE = 'Choose today or a later date.';
const SEATS_MESSAGE = 'Buy from 1 to 500 seats.';
const SELF_PACED_MESSAGE = 'Seat packs are sold for self-paced courses only.';
const YEAR_MESSAGE = 'Choose a year from 2000 to 2100.';
const FROM_MESSAGE = 'Enter a start date as YYYY-MM-DD.';
const TO_MESSAGE = 'Enter an end date as YYYY-MM-DD.';
const TO_ORDER_MESSAGE = 'The end date must be on or after the start date.';
const TO_SPAN_MESSAGE = 'Export at most 366 days at a time.';
const SEARCH_MESSAGE = 'Search with at most 100 characters.';

const EXPORT_HEADER = [
  'nurse_name',
  'nurse_email',
  'course_title',
  'serial',
  'issued_on',
  'contact_hours',
  'funding',
] as const;

interface Hospital {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

function hospitalOf(ctx: RequestContext): { user: AuthUser; hospital: Hospital } {
  const user = requireUser(ctx);
  if (user.organisationId === null || user.organisationName === null || user.organisationSlug === null) {
    throw notFound();
  }
  return {
    user,
    hospital: { id: user.organisationId, name: user.organisationName, slug: user.organisationSlug },
  };
}

async function readDashboard(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  await settleExpiryForOrganisation(pool, hospital.id, ctx.at);
  const totals = await sponsorTotals(pool, hospital.id);
  return {
    status: 200,
    json: { ...totals, coverage: await coverageJson(pool, hospital.id, ctx.at) },
  };
}

async function patchCoverage(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  const validator = new Validator(ctx.body, ['coverage_percent', 'effective_on']);
  const percent = parsePercent(ctx.body?.['coverage_percent']);
  if (percent === null) validator.add('coverage_percent', PERCENT_MESSAGE);
  const effectiveOn = ctx.body?.['effective_on'];
  const today = providerToday(ctx.at);
  const parsed = parseDateOnly(effectiveOn);
  if (parsed === null || typeof effectiveOn !== 'string' || effectiveOn < today) {
    validator.add('effective_on', EFFECTIVE_MESSAGE);
  }
  validator.throwIfInvalid();
  if (percent === null || typeof effectiveOn !== 'string') throw new Error('Validated coverage is complete');

  await withTransaction((client) => saveCoverage(client, hospital.id, percent, effectiveOn, ctx.at));
  return { status: 200, json: await coverageJson(pool, hospital.id, ctx.at) };
}

async function readPacks(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  await settleExpiryForOrganisation(pool, hospital.id, ctx.at);
  const rows = await listPacks(pool, hospital.id);
  const packs = [];
  for (const row of rows) packs.push(await packJson(pool, row, ctx.at));
  return { status: 200, json: { packs } };
}

async function courseForPack(ctx: RequestContext, courseId: unknown): Promise<CourseRow> {
  const user = requireUser(ctx);
  if (typeof courseId !== 'string') throw notFound();
  const course = await getCourse(pool, courseId);
  if (course === null || !canReadCourse(course, user)) throw notFound();
  return course;
}

async function buyPack(ctx: RequestContext): Promise<Reply> {
  const { user, hospital } = hospitalOf(ctx);
  const course = await courseForPack(ctx, ctx.body?.['course_id']);
  const key = readIdempotencyKey(ctx.request.headers['idempotency-key']);

  return runIdempotent(user.id, key, ctx.body, async () => {
    if (!isOpenForEnrolment(course.state)) throw conflict('course_not_open');

    const validator = new Validator(ctx.body, ['course_id', 'seats']);
    if (course.format !== 'self_paced') validator.add('course_id', SELF_PACED_MESSAGE);
    const seats = ctx.body?.['seats'];
    if (typeof seats !== 'number' || !Number.isInteger(seats) || seats < 1 || seats > 500) {
      validator.add('seats', SEATS_MESSAGE);
    }
    validator.throwIfInvalid();
    if (typeof seats !== 'number') throw new Error('Validated seats are a number');

    const packId = newId();
    const priceTotalCents = seats * course.list_price_cents;
    const accountId = await ensureAccount(
      hospitalAccountExternalKey(hospital.slug),
      hospital.name,
      user.id,
    );
    const paymentId = await purchase({
      accountId,
      amountCents: priceTotalCents,
      paymentExternalKey: `pack-${packId}`,
      actingUserId: user.id,
    });

    const json = await withTransaction(async (client) => {
      const purchasedAt = new Date();
      await client.query(
        `INSERT INTO packs
           (id, organisation_id, course_id, seats_purchased, price_total_cents, purchased_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [packId, hospital.id, course.id, seats, priceTotalCents, purchasedAt, packExpiresAt(purchasedAt)],
      );
      await postMovement(client, { packId, kind: 'purchase', seats, nurseId: null, assignmentId: null });
      await client.query(
        `INSERT INTO payments (id, pack_id, party, external_key, killbill_payment_id, amount_cents)
         VALUES ($1, $2, 'hospital', $3, $4, $5)`,
        [newId(), packId, `pack-${packId}`, paymentId, priceTotalCents],
      );
      const pack = await getPack(client, packId);
      if (pack === null) throw new Error('The new pack was not written');
      return packJson(client, pack, ctx.at);
    });
    return { status: 201, json: { pack: json } };
  });
}

async function hospitalPack(ctx: RequestContext, hospitalId: string): Promise<NonNullable<Awaited<ReturnType<typeof getPack>>>> {
  const pack = await getPack(pool, param(ctx, 'id'));
  if (pack === null || pack.organisation_id !== hospitalId) throw notFound();
  return pack;
}

async function readLedger(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  const pack = await hospitalPack(ctx, hospital.id);
  await settlePackExpiry(pack.id, ctx.at);
  return {
    status: 200,
    json: {
      pack_id: pack.id,
      balance: await packBalance(pool, pack.id),
      entries: await ledgerJson(pool, pack.id),
    },
  };
}

async function assignSeat(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  const pack = await hospitalPack(ctx, hospital.id);
  const nurseId = ctx.body?.['nurse_id'];
  if (typeof nurseId !== 'string') throw notFound();
  const nurse = await one<{ id: string; email: string; display_name: string }>(
    pool,
    `SELECT id, email, display_name FROM users
     WHERE id = $1 AND role = 'learner' AND organisation_id = $2`,
    [nurseId, hospital.id],
  );
  if (nurse === null) throw notFound();

  await settlePackExpiry(pack.id, ctx.at);
  const course = await getCourse(pool, pack.course_id);
  if (course === null) throw new Error('A pack always has a course');
  if (!isOpenForEnrolment(course.state)) throw conflict('course_not_open');
  if (hasExpired(pack.expires_at, ctx.at)) throw conflict('pack_expired');

  const result = await withSerializable(async (client) => {
    const live = await one<{ id: string }>(
      client,
      `SELECT id FROM enrolments WHERE user_id = $1 AND course_id = $2 AND state = ANY($3)`,
      [nurse.id, course.id, ACTIVE_ENROLMENT_STATES],
    );
    if (live !== null) throw conflict('already_enrolled');
    if ((await packBalance(client, pack.id)) <= 0) throw conflict('pack_empty');
    new Validator(ctx.body, ['nurse_id']).throwIfInvalid();

    const enrolmentId = newId();
    const assignmentId = newId();
    await client.query(
      `INSERT INTO enrolments
         (id, user_id, course_id, cohort_id, state, funding, sponsor_organisation_id,
          list_price_cents, employer_share_cents, learner_share_cents)
       VALUES ($1, $2, $3, NULL, 'confirmed', 'seat', $4, $5, $5, 0)`,
      [enrolmentId, nurse.id, course.id, hospital.id, course.list_price_cents],
    );
    await client.query(
      `INSERT INTO seat_assignments (id, pack_id, nurse_id, enrolment_id, state)
       VALUES ($1, $2, $3, $4, 'assigned')`,
      [assignmentId, pack.id, nurse.id, enrolmentId],
    );
    await postMovement(client, {
      packId: pack.id,
      kind: 'assignment',
      seats: 1,
      nurseId: nurse.id,
      assignmentId,
    });
    await queueEmail(
      client,
      seatInvitation({
        to: nurse.email,
        hospitalName: hospital.name,
        courseTitle: course.title,
        courseUrl: `${ctx.origin}/courses/${course.id}`,
        assignmentId,
      }),
    );
    const enrolment = await getEnrolment(client, enrolmentId);
    if (enrolment === null) throw new Error('The seat enrolment was not written');
    return {
      assignment: {
        id: assignmentId,
        pack_id: pack.id,
        nurse_id: nurse.id,
        enrolment_id: enrolmentId,
        state: 'assigned' as const,
      },
      enrolment: await enrolmentJson(client, enrolment),
    };
  });
  return { status: 201, json: result };
}

/** A seat can be returned only while its enrolment is confirmed with no verified minutes. */
async function returnSeat(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  const assignment = await one<{
    id: string;
    pack_id: string;
    nurse_id: string;
    enrolment_id: string;
    state: string;
  }>(
    pool,
    `SELECT a.id, a.pack_id, a.nurse_id, a.enrolment_id, a.state
     FROM seat_assignments a JOIN packs p ON p.id = a.pack_id
     WHERE a.id = $1 AND p.organisation_id = $2`,
    [param(ctx, 'id'), hospital.id],
  );
  if (assignment === null) throw notFound();

  const result = await withSerializable(async (client) => {
    const locked = await one<{ state: string }>(
      client,
      'SELECT state FROM seat_assignments WHERE id = $1 FOR UPDATE',
      [assignment.id],
    );
    if (locked === null) throw notFound();
    if (locked.state !== 'assigned') throw conflict('already_returned');
    const enrolment = await getEnrolment(client, assignment.enrolment_id);
    if (enrolment === null) throw new Error('An assignment always has an enrolment');
    if (enrolment.state !== 'confirmed' || (await verifiedMinutes(client, enrolment)) > 0) {
      throw conflict('seat_in_use');
    }
    new Validator(ctx.body, []).throwIfInvalid();

    await client.query(`UPDATE seat_assignments SET state = 'returned', returned_at = now() WHERE id = $1`, [
      assignment.id,
    ]);
    await client.query(`UPDATE enrolments SET state = 'withdrawn' WHERE id = $1`, [enrolment.id]);
    await postMovement(client, {
      packId: assignment.pack_id,
      kind: 'return',
      seats: 1,
      nurseId: assignment.nurse_id,
      assignmentId: assignment.id,
    });
    const refreshed = await getEnrolment(client, enrolment.id);
    if (refreshed === null) throw new Error('The enrolment vanished mid-return');
    return {
      assignment: {
        id: assignment.id,
        pack_id: assignment.pack_id,
        nurse_id: assignment.nurse_id,
        enrolment_id: assignment.enrolment_id,
        state: 'returned' as const,
      },
      enrolment: await enrolmentJson(client, refreshed),
    };
  });
  return { status: 200, json: result };
}

async function readLearners(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  const text = ctx.query.get('q') ?? '';
  const validator = new Validator(ctx.body, []);
  if (text.length > 100) validator.add('q', SEARCH_MESSAGE);
  validator.throwIfInvalid();
  return { status: 200, json: { learners: await searchLearners(pool, hospital.id, text) } };
}

async function readLearner(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  const nurseId = param(ctx, 'id');
  const nurse = await one<{ id: string; display_name: string; email: string }>(
    pool,
    `SELECT id, display_name, email FROM users WHERE id = $1 AND organisation_id = $2 AND role = 'learner'`,
    [nurseId, hospital.id],
  );
  if (nurse === null) throw notFound();

  const enrolmentRows = await query<{ id: string }>(
    pool,
    `SELECT id FROM enrolments
     WHERE user_id = $1 AND sponsor_organisation_id = $2 AND funding IN ('seat', 'co_pay')
     ORDER BY enrolled_at DESC`,
    [nurse.id, hospital.id],
  );
  if (enrolmentRows.length === 0) throw notFound();

  const enrolments = [];
  for (const row of enrolmentRows) {
    const enrolment = await getEnrolment(pool, row.id);
    if (enrolment !== null) enrolments.push(await enrolmentJson(pool, enrolment));
  }
  const sealed = await sealedCertificatesForHospital(pool, hospital.id, nurse.id);
  const certificates = [];
  for (const entry of sealed) {
    const certificate = await one<CertificateRow>(
      pool,
      `SELECT ce.id, ce.enrolment_id, ce.user_id, ce.serial, ce.contact_hours_hundredths,
              ce.verified_module_count, c.title AS course_title, e.sponsor_organisation_id, e.funding
       FROM certificates ce
       JOIN enrolments e ON e.id = ce.enrolment_id
       JOIN courses c ON c.id = e.course_id
       WHERE ce.id = $1`,
      [entry.id],
    );
    if (certificate !== null) certificates.push(await certificateJsonById(pool, certificate));
  }
  return {
    status: 200,
    json: {
      learner: { id: nurse.id, display_name: nurse.display_name, email: nurse.email },
      enrolments,
      certificates,
    },
  };
}

async function readMonthly(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  const raw = ctx.query.get('year');
  const year = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  const validator = new Validator(ctx.body, []);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) validator.add('year', YEAR_MESSAGE);
  validator.throwIfInvalid();
  return { status: 200, json: { year, months: await monthlyReport(pool, hospital.id, year) } };
}

async function createExport(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  const validator = new Validator(ctx.body, ['from', 'to']);
  const fromRaw = ctx.body?.['from'];
  const toRaw = ctx.body?.['to'];
  const from = parseDateOnly(fromRaw);
  const to = parseDateOnly(toRaw);
  if (from === null || typeof fromRaw !== 'string') validator.add('from', FROM_MESSAGE);
  if (to === null || typeof toRaw !== 'string') validator.add('to', TO_MESSAGE);
  else if (typeof fromRaw === 'string' && from !== null) {
    if (fromRaw > toRaw) validator.add('to', TO_ORDER_MESSAGE);
    else if (inclusiveDaySpan(fromRaw, toRaw) > 366) validator.add('to', TO_SPAN_MESSAGE);
  }
  validator.throwIfInvalid();
  if (typeof fromRaw !== 'string' || typeof toRaw !== 'string') throw new Error('Validated dates are strings');

  const certificates = (await sealedCertificatesForHospital(pool, hospital.id)).filter(
    (certificate) => certificate.issued_on >= fromRaw && certificate.issued_on <= toRaw,
  );
  const document = csvDocument(
    EXPORT_HEADER,
    certificates.map((certificate) => [
      certificate.nurse_name,
      certificate.nurse_email,
      certificate.course_title,
      certificate.serial,
      certificate.issued_on,
      formatHours(certificate.contact_hours_hundredths),
      certificate.funding,
    ]),
  );

  const exportId = newId();
  const objectKey = exportObjectKey(hospital.slug, exportId);
  await putObject(objectKey, Buffer.from(document, 'utf8'), 'text/csv');
  await pool.query(
    `INSERT INTO completion_exports (id, organisation_id, from_date, to_date, rows, object_key)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [exportId, hospital.id, fromRaw, toRaw, certificates.length, objectKey],
  );
  return {
    status: 201,
    json: {
      export: {
        id: exportId,
        rows: certificates.length,
        download_url: `/api/sponsor/exports/${exportId}.csv`,
      },
    },
  };
}

async function downloadExport(ctx: RequestContext): Promise<Reply> {
  const { hospital } = hospitalOf(ctx);
  const file = param(ctx, 'file');
  if (!file.endsWith('.csv')) throw notFound();
  const row = await one<{ object_key: string }>(
    pool,
    'SELECT object_key FROM completion_exports WHERE id = $1 AND organisation_id = $2',
    [file.slice(0, -4), hospital.id],
  );
  if (row === null) throw notFound();
  return {
    status: 200,
    body: await getObject(row.object_key),
    contentType: 'text/csv; charset=utf-8',
  };
}

export const sponsorRoutes: readonly Route[] = [
  { method: 'GET', path: '/api/sponsor/dashboard', auth: 'required', roles: ['coordinator'], handler: readDashboard },
  { method: 'PATCH', path: '/api/sponsor/coverage', auth: 'required', roles: ['coordinator'], handler: patchCoverage },
  { method: 'GET', path: '/api/sponsor/packs', auth: 'required', roles: ['coordinator'], handler: readPacks },
  { method: 'POST', path: '/api/sponsor/packs', auth: 'required', roles: ['coordinator'], handler: buyPack },
  {
    method: 'GET',
    path: '/api/sponsor/packs/:id/ledger',
    auth: 'required',
    roles: ['coordinator'],
    handler: readLedger,
  },
  {
    method: 'POST',
    path: '/api/sponsor/packs/:id/assignments',
    auth: 'required',
    roles: ['coordinator'],
    handler: assignSeat,
  },
  {
    method: 'DELETE',
    path: '/api/sponsor/assignments/:id',
    auth: 'required',
    roles: ['coordinator'],
    handler: returnSeat,
  },
  { method: 'GET', path: '/api/sponsor/learners', auth: 'required', roles: ['coordinator'], handler: readLearners },
  { method: 'GET', path: '/api/sponsor/learners/:id', auth: 'required', roles: ['coordinator'], handler: readLearner },
  {
    method: 'GET',
    path: '/api/sponsor/reports/monthly',
    auth: 'required',
    roles: ['coordinator'],
    handler: readMonthly,
  },
  { method: 'POST', path: '/api/sponsor/exports', auth: 'required', roles: ['coordinator'], handler: createExport },
  {
    method: 'GET',
    path: '/api/sponsor/exports/:file',
    auth: 'required',
    roles: ['coordinator'],
    handler: downloadExport,
  },
];
