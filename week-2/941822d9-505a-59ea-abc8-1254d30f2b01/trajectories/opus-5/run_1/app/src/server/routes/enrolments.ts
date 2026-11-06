import { one, pool, withSerializable, withTransaction } from '../db/pool.js';
import { certificateJsonById, getCertificate } from '../data/certificates.js';
import {
  canReadEnrolment,
  enrolmentJson,
  getEnrolment,
  listEnrolmentsOf,
  type EnrolmentRow,
} from '../data/enrolments.js';
import { getRefundRequest, refundRequestJson } from '../data/refunds.js';
import { contactHoursHundredths } from '../domain/contactHours.js';
import { formatSerial } from '../domain/certificate.js';
import { hasFinishedActivity, isInactiveForStudy } from '../domain/enrolment.js';
import { providerDate } from '../domain/providerTime.js';
import { conflict, notFound, Validator } from '../http/errors.js';
import { param, requireUser, type Reply, type RequestContext } from '../http/context.js';
import type { Route } from '../http/router.js';
import { trySealVersion } from '../services/sealing.js';
import { newId } from '../util/ids.js';

const WRONG_ANSWER_MESSAGE = 'That is not the best answer. Review the lesson and try again.';
const RATING_MESSAGE = 'Choose a rating from 1 to 5.';
const OUTCOMES_MESSAGE = 'Answer yes or no.';
const COMMENT_MESSAGE = 'Keep comments under 1000 characters.';
const REASON_MESSAGE = 'Tell the planner why you are asking for a refund.';

interface ModuleDetailRow {
  readonly id: string;
  readonly title: string;
  readonly minutes: number;
  readonly kind: 'lesson' | 'evaluation';
  readonly body: string | null;
  readonly question_prompt: string | null;
  readonly question_options: string[] | null;
  readonly answer_index: number | null;
  readonly verified: boolean;
}

async function ownEnrolment(ctx: RequestContext): Promise<EnrolmentRow> {
  const user = requireUser(ctx);
  const enrolment = await getEnrolment(pool, param(ctx, 'id'));
  if (enrolment === null || enrolment.user_id !== user.id) throw notFound();
  return enrolment;
}

async function moduleOfEnrolment(
  enrolment: EnrolmentRow,
  moduleId: string,
): Promise<ModuleDetailRow> {
  const module = await one<ModuleDetailRow>(
    pool,
    `SELECT m.id, m.title, m.minutes, m.kind, m.body, m.question_prompt, m.question_options, m.answer_index,
            (v.id IS NOT NULL) AS verified
     FROM course_modules m
     LEFT JOIN module_verifications v ON v.module_id = m.id AND v.enrolment_id = $1
     WHERE m.id = $2 AND m.course_id = $3`,
    [enrolment.id, moduleId, enrolment.course_id],
  );
  if (module === null) throw notFound();
  return module;
}

async function listMyEnrolments(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const rows = await listEnrolmentsOf(pool, user.id);
  const enrolments = [];
  for (const row of rows) enrolments.push(await enrolmentJson(pool, row));
  return { status: 200, json: { enrolments } };
}

async function readEnrolment(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const enrolment = await getEnrolment(pool, param(ctx, 'id'));
  if (enrolment === null || !canReadEnrolment(enrolment, user)) throw notFound();
  return { status: 200, json: { enrolment: await enrolmentJson(pool, enrolment) } };
}

/** The learner's view of a module never carries the correct answer. */
async function readModule(ctx: RequestContext): Promise<Reply> {
  const enrolment = await ownEnrolment(ctx);
  const module = await moduleOfEnrolment(enrolment, param(ctx, 'moduleId'));
  return {
    status: 200,
    json: {
      module: {
        id: module.id,
        title: module.title,
        minutes: module.minutes,
        kind: module.kind,
        body: module.body,
        question:
          module.question_prompt === null || module.question_options === null
            ? null
            : { prompt: module.question_prompt, options: module.question_options },
      },
      status: module.verified ? 'verified' : 'unverified',
    },
  };
}

async function answerModule(ctx: RequestContext): Promise<Reply> {
  const enrolment = await ownEnrolment(ctx);
  const module = await moduleOfEnrolment(enrolment, param(ctx, 'moduleId'));
  if (isInactiveForStudy(enrolment.state)) throw conflict('enrolment_inactive');
  if (module.kind !== 'lesson') throw conflict('not_a_lesson');
  if (module.verified) {
    return { status: 200, json: { enrolment: await enrolmentJson(pool, enrolment) } };
  }

  const validator = new Validator(ctx.body, ['option_index']);
  const chosen = ctx.body?.['option_index'];
  if (typeof chosen !== 'number' || !Number.isInteger(chosen) || chosen !== module.answer_index) {
    validator.add('option_index', WRONG_ANSWER_MESSAGE);
  }
  validator.throwIfInvalid();

  await pool.query(
    `INSERT INTO module_verifications (id, enrolment_id, module_id) VALUES ($1, $2, $3)
     ON CONFLICT (enrolment_id, module_id) DO NOTHING`,
    [newId(), enrolment.id, module.id],
  );
  const refreshed = await getEnrolment(pool, enrolment.id);
  if (refreshed === null) throw new Error('The enrolment vanished mid-answer');
  return { status: 200, json: { enrolment: await enrolmentJson(pool, refreshed) } };
}

interface CertificateCreation {
  readonly certificateId: string;
  readonly created: boolean;
}

/**
 * The certificate is created in the same serialisable transaction that completes the
 * enrolment, so concurrent and repeat submits all end up on one certificate.
 */
async function createCertificate(
  enrolment: EnrolmentRow,
  nurseName: string,
  origin: string,
  at: Date,
): Promise<CertificateCreation> {
  return withSerializable(async (client) => {
    const existing = await one<{ id: string }>(
      client,
      'SELECT id FROM certificates WHERE enrolment_id = $1',
      [enrolment.id],
    );
    if (existing !== null) return { certificateId: existing.id, created: false };

    const evaluationModule = await one<{ id: string; minutes: number }>(
      client,
      `SELECT id, minutes FROM course_modules WHERE course_id = $1 AND kind = 'evaluation'`,
      [enrolment.course_id],
    );
    if (evaluationModule === null) throw new Error('Every course has a post-evaluation module');
    await client.query(
      `INSERT INTO module_verifications (id, enrolment_id, module_id) VALUES ($1, $2, $3)
       ON CONFLICT (enrolment_id, module_id) DO NOTHING`,
      [newId(), enrolment.id, evaluationModule.id],
    );

    const verified = await one<{ minutes: string; count: string }>(
      client,
      `SELECT coalesce(sum(m.minutes), 0)::text AS minutes, count(*)::text AS count
       FROM module_verifications v JOIN course_modules m ON m.id = v.module_id
       WHERE v.enrolment_id = $1`,
      [enrolment.id],
    );
    if (verified === null) throw new Error('Verified minutes are always countable');
    const verifiedMinutes = Number.parseInt(verified.minutes, 10);
    const verifiedCount = Number.parseInt(verified.count, 10);

    const sequence = await one<{ nextval: string }>(client, `SELECT nextval('certificate_serial_seq')::text AS nextval`);
    if (sequence === null) throw new Error('The serial sequence is missing');
    const serial = formatSerial(
      Number.parseInt(providerDate(at).slice(0, 4), 10),
      Number.parseInt(sequence.nextval, 10),
    );

    const certificateId = newId();
    await client.query(
      `INSERT INTO certificates
         (id, enrolment_id, user_id, serial, contact_hours_hundredths, verified_module_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        certificateId,
        enrolment.id,
        enrolment.user_id,
        serial,
        contactHoursHundredths(verifiedMinutes),
        verifiedCount,
      ],
    );
    await client.query(
      `INSERT INTO certificate_versions (id, certificate_id, version, state, nurse_name, origin)
       VALUES ($1, $2, 1, 'sealing', $3, $4)`,
      [newId(), certificateId, nurseName, origin],
    );
    await client.query(`UPDATE enrolments SET state = 'completed' WHERE id = $1`, [enrolment.id]);
    return { certificateId, created: true };
  });
}

async function submitEvaluation(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const enrolment = await ownEnrolment(ctx);

  const already = await one<{ id: string }>(pool, 'SELECT id FROM certificates WHERE enrolment_id = $1', [
    enrolment.id,
  ]);
  if (already !== null) {
    const certificate = await getCertificate(pool, already.id);
    if (certificate === null) throw new Error('The certificate vanished');
    return { status: 200, json: { certificate: await certificateJsonById(pool, certificate) } };
  }

  if (isInactiveForStudy(enrolment.state)) throw conflict('enrolment_inactive');
  const unverified = await one<{ count: string }>(
    pool,
    `SELECT count(*)::text AS count FROM course_modules m
     WHERE m.course_id = $1 AND m.kind = 'lesson'
       AND NOT EXISTS (
         SELECT 1 FROM module_verifications v WHERE v.module_id = m.id AND v.enrolment_id = $2
       )`,
    [enrolment.course_id, enrolment.id],
  );
  if (unverified !== null && Number.parseInt(unverified.count, 10) > 0) {
    throw conflict('lessons_unverified');
  }

  const validator = new Validator(ctx.body, ['rating', 'met_outcomes', 'comment']);
  const rating = ctx.body?.['rating'];
  const metOutcomes = ctx.body?.['met_outcomes'];
  const commentRaw = ctx.body?.['comment'];
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    validator.add('rating', RATING_MESSAGE);
  }
  if (typeof metOutcomes !== 'boolean') validator.add('met_outcomes', OUTCOMES_MESSAGE);
  const comment =
    commentRaw === undefined || commentRaw === null ? null : typeof commentRaw === 'string' ? commentRaw : '';
  if (comment !== null && (typeof commentRaw !== 'string' || comment.length > 1000)) {
    validator.add('comment', COMMENT_MESSAGE);
  }
  validator.throwIfInvalid();

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO evaluations (id, enrolment_id, rating, met_outcomes, comment)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (enrolment_id) DO NOTHING`,
      [newId(), enrolment.id, rating, metOutcomes, comment],
    );
  });

  const creation = await createCertificate(enrolment, user.displayName, ctx.origin, ctx.at);
  if (creation.created) await trySealVersion(creation.certificateId, 1);

  const certificate = await getCertificate(pool, creation.certificateId);
  if (certificate === null) throw new Error('The new certificate vanished');
  const json = await certificateJsonById(pool, certificate);
  if (!creation.created) return { status: 200, json: { certificate: json } };
  return { status: json.state === 'sealed' ? 201 : 202, json: { certificate: json } };
}

async function requestRefund(ctx: RequestContext): Promise<Reply> {
  const enrolment = await ownEnrolment(ctx);
  if (hasFinishedActivity(enrolment.state)) throw conflict('already_certified');
  if (enrolment.funding === 'seat' || enrolment.state !== 'confirmed') throw conflict('not_refundable');
  const pending = await one<{ id: string }>(
    pool,
    `SELECT id FROM refund_requests WHERE enrolment_id = $1 AND state = 'pending'`,
    [enrolment.id],
  );
  if (pending !== null) throw conflict('refund_pending');

  const validator = new Validator(ctx.body, ['reason']);
  const raw = ctx.body?.['reason'];
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length === 0 || reason.length > 500) validator.add('reason', REASON_MESSAGE);
  validator.throwIfInvalid();

  const requestId = newId();
  await pool.query(
    `INSERT INTO refund_requests (id, enrolment_id, reason, state) VALUES ($1, $2, $3, 'pending')`,
    [requestId, enrolment.id, reason],
  );
  const created = await getRefundRequest(pool, requestId);
  if (created === null) throw new Error('The refund request was not written');
  return { status: 201, json: { refund_request: await refundRequestJson(pool, created, ctx.at) } };
}

export const enrolmentRoutes: readonly Route[] = [
  { method: 'GET', path: '/api/me/enrolments', auth: 'required', roles: ['learner'], handler: listMyEnrolments },
  { method: 'GET', path: '/api/enrolments/:id', auth: 'required', handler: readEnrolment },
  {
    method: 'GET',
    path: '/api/enrolments/:id/modules/:moduleId',
    auth: 'required',
    roles: ['learner'],
    handler: readModule,
  },
  {
    method: 'POST',
    path: '/api/enrolments/:id/modules/:moduleId/answer',
    auth: 'required',
    roles: ['learner'],
    handler: answerModule,
  },
  {
    method: 'POST',
    path: '/api/enrolments/:id/evaluation',
    auth: 'required',
    roles: ['learner'],
    handler: submitEvaluation,
  },
  {
    method: 'POST',
    path: '/api/enrolments/:id/refund-request',
    auth: 'required',
    roles: ['learner'],
    handler: requestRefund,
  },
];
