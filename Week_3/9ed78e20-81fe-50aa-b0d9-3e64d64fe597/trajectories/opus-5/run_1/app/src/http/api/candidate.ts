import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import { pool, query, withTransaction, type Queryable } from '../../db/pool.js';
import { appendAuditEntry } from '../../domain/audit.js';
import {
  CONSENT_MESSAGE,
  EMAIL_MESSAGE,
  NAME_MESSAGE,
  RESUME_MESSAGE,
  newReference,
  newResumeKey,
  normaliseEmail,
  tokenDigest,
  validCandidateEmail,
  validCandidateName,
  validResume,
} from '../../domain/candidate.js';
import { officeLabel } from '../../domain/careers.js';
import { issueTrackingToken } from '../../domain/tracking.js';
import {
  STAGE_LABELS,
  applicationMoveAllowed,
  type ApplicationStage,
} from '../../domain/lifecycle.js';
import {
  queueApplicationReceipt,
  queueResentLinks,
  queueStageNotice,
} from '../../services/notifications.js';
import { storageIsUp } from '../../services/probes.js';
import { deleteObject, putObject } from '../../services/storage.js';
import { ApiError, errors } from '../errors.js';
import {
  claimIdempotencyKey,
  fingerprintMultipart,
  readIdempotencyKey,
} from '../idempotency.js';
import { jsonReply, type Reply } from '../reply.js';
import { candidateFormPage } from '../pages/candidatepages.js';
import { route, type Ctx } from '../server.js';

const TRACKING_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const;

type ApplicationRow = {
  id: string;
  requisition_id: string;
  reference: string;
  name: string;
  email: string;
  stage: ApplicationStage;
  submitted_at: Date;
  stage_changed_at: Date;
  version: number;
};

function applicationBody(input: {
  readonly reference: string;
  readonly slug: string;
  readonly title: string;
  readonly submittedAt: Date;
}): Record<string, unknown> {
  return {
    application: {
      reference: input.reference,
      role: { slug: input.slug, title: input.title },
      stage: 'submitted',
      submitted_at: input.submittedAt.toISOString(),
    },
  };
}

async function submitApplication(ctx: Ctx): Promise<Reply> {
  const form = ctx.form();
  const slug = ctx.params.slug as string;
  const resume = form.files.resume;
  const resumeBytes = resume?.bytes ?? Buffer.alloc(0);

  const key = readIdempotencyKey(
    Array.isArray(ctx.headers['idempotency-key'])
      ? ctx.headers['idempotency-key'][0]
      : ctx.headers['idempotency-key'],
  );
  let finish: ((reply: Reply) => Promise<void>) | null = null;
  if (key !== null) {
    const claim = await claimIdempotencyKey(
      `role:${slug}`,
      key,
      fingerprintMultipart(ctx.method, ctx.path, form.fields, resumeBytes),
    );
    if (claim.kind === 'replay') return claim.reply;
    finish = claim.finish;
  }

  let reply: Reply;
  try {
    reply = await runSubmission(ctx, slug, form.fields, resumeBytes);
  } catch (error) {
    const formError =
      error instanceof ApiError && [409, 415, 422, 503].includes(error.status) && ctx.wantsHtml;
    if (!formError) throw error;
    const failure = error as ApiError;
    reply = jsonReply(failure.status, failure.body(), failure.headers ?? {});
  }
  if (finish !== null) await finish(reply);
  if (!ctx.wantsHtml) return reply;
  return candidateFormPage(ctx, reply, {
    email: (form.fields.email ?? '').trim().toLowerCase(),
    backHref: `/careers/${slug}`,
    backLabel: 'Back to the role',
  });
}

async function runSubmission(
  ctx: Ctx,
  slug: string,
  fields: Readonly<Record<string, string>>,
  resumeBytes: Buffer,
): Promise<Reply> {
  const requisitions = await query<{
    id: string;
    slug: string;
    title: string;
    status: string;
  }>('SELECT id, slug, title, status FROM requisitions WHERE slug = $1', [slug]);
  const requisition = requisitions.rows[0];
  if (requisition === undefined || requisition.status === 'draft') throw errors.publicNotFound();

  const name = (fields.name ?? '').trim();
  const email = (fields.email ?? '').trim();
  const consent = fields.consent ?? '';
  const invalid: Record<string, string> = {};
  if (!validCandidateName(name)) invalid.name = NAME_MESSAGE;
  if (!validCandidateEmail(email)) invalid.email = EMAIL_MESSAGE;
  if (consent !== 'yes') invalid.consent = CONSENT_MESSAGE;
  if (!validResume(resumeBytes)) invalid.resume = RESUME_MESSAGE;
  if (Object.keys(invalid).length > 0) throw errors.validationFailed(invalid);

  const storedEmail = normaliseEmail(email);
  const existing = await query<ApplicationRow>(
    `SELECT id, requisition_id, reference, name, email, stage, submitted_at, stage_changed_at, version
       FROM applications WHERE requisition_id = $1 AND email = $2 AND erased_at IS NULL`,
    [requisition.id, storedEmail],
  );
  const duplicate = existing.rows[0];
  if (duplicate !== undefined) {
    return jsonReply(
      200,
      applicationBody({
        reference: duplicate.reference,
        slug: requisition.slug,
        title: requisition.title,
        submittedAt: duplicate.submitted_at,
      }),
    );
  }

  if (requisition.status === 'closed') {
    throw errors.conflict('requisition_closed', 'This role is no longer accepting applications.');
  }

  if (!storageIsUp()) {
    throw errors.storageUnavailable(
      "We couldn't store your résumé just now. Nothing was submitted; please try again in a few minutes.",
    );
  }

  const resumeKey = newResumeKey(requisition.id);
  try {
    await putObject(resumeKey, resumeBytes, 'application/pdf');
  } catch {
    throw errors.storageUnavailable(
      "We couldn't store your résumé just now. Nothing was submitted; please try again in a few minutes.",
    );
  }

  try {
    const created = await withTransaction(async (tx) => {
      const applicationId = randomUUID();
      const reference = newReference();
      const inserted = await tx.query<{ submitted_at: Date }>(
        `INSERT INTO applications (id, requisition_id, reference, name, email, stage, resume_key,
           submitted_at, stage_changed_at, version)
         VALUES ($1,$2,$3,$4,$5,'submitted',$6, now(), now(), 1)
         RETURNING submitted_at`,
        [applicationId, requisition.id, reference, name, storedEmail, resumeKey],
      );
      const token = await issueTrackingToken(tx, applicationId);
      await queueApplicationReceipt(tx, {
        to: { name, email: storedEmail },
        roleTitle: requisition.title,
        reference,
        token,
      });
      return {
        reference,
        submittedAt: inserted.rows[0]?.submitted_at ?? new Date(),
      };
    });
    return jsonReply(
      201,
      applicationBody({
        reference: created.reference,
        slug: requisition.slug,
        title: requisition.title,
        submittedAt: created.submittedAt,
      }),
    );
  } catch (error) {
    await deleteObject(resumeKey).catch(() => undefined);
    const raced = await query<ApplicationRow>(
      `SELECT id, requisition_id, reference, name, email, stage, submitted_at, stage_changed_at, version
         FROM applications WHERE requisition_id = $1 AND email = $2 AND erased_at IS NULL`,
      [requisition.id, storedEmail],
    );
    const winner = raced.rows[0];
    if (winner !== undefined) {
      return jsonReply(
        200,
        applicationBody({
          reference: winner.reference,
          slug: requisition.slug,
          title: requisition.title,
          submittedAt: winner.submitted_at,
        }),
      );
    }
    throw error;
  }
}

type TrackedApplication = {
  id: string;
  reference: string;
  name: string;
  email: string;
  stage: ApplicationStage;
  submitted_at: Date;
  stage_changed_at: Date;
  title: string;
  office: string;
};

async function loadTracked(
  tx: Queryable,
  token: string,
): Promise<TrackedApplication | undefined> {
  const result = await tx.query<TrackedApplication>(
    `SELECT a.id, a.reference, a.name, a.email, a.stage, a.submitted_at, a.stage_changed_at,
            r.title, r.office
       FROM tracking_links t
       JOIN applications a ON a.id = t.application_id
       JOIN requisitions r ON r.id = a.requisition_id
      WHERE t.token_digest = $1 AND t.retired_at IS NULL AND a.erased_at IS NULL
        AND (r.status <> 'closed' OR r.retention_deadline IS NULL OR r.retention_deadline > now())`,
    [tokenDigest(token)],
  );
  return result.rows[0];
}

function trackingBody(application: TrackedApplication): Record<string, unknown> {
  return {
    role: { title: application.title, office: officeLabel(application.office) },
    stage: application.stage,
    stage_label: STAGE_LABELS[application.stage],
    submitted_at: application.submitted_at.toISOString(),
    stage_changed_at: application.stage_changed_at.toISOString(),
  };
}

/** The resend form is also posted by browsers without scripts, as a plain HTML form. */
function readResendEmail(ctx: Ctx): string {
  const header = ctx.headers['content-type'];
  const contentType = (Array.isArray(header) ? header[0] : header) ?? '';
  if (ctx.wantsHtml && contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return (new URLSearchParams(ctx.body.toString('utf8')).get('email') ?? '').trim();
  }
  const payload = ctx.json() as { email?: unknown };
  return typeof payload.email === 'string' ? payload.email.trim() : '';
}

export function registerCandidateApi(): void {
  route('POST', '/api/careers/roles/:slug/applications', 'candidate', submitApplication);

  route('POST', '/api/careers/tracking-links', 'candidate', async (ctx) => {
    const email = readResendEmail(ctx);
    if (!validCandidateEmail(email)) {
      const invalid = errors.validationFailed({ email: EMAIL_MESSAGE });
      if (!ctx.wantsHtml) throw invalid;
      return candidateFormPage(ctx, jsonReply(invalid.status, invalid.body()), {
        email,
        backHref: '/careers',
        backLabel: 'Back to open roles',
      });
    }
    const stored = normaliseEmail(email);

    await withTransaction(async (tx) => {
      const recent = await tx.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM resend_events
          WHERE email = $1 AND at > now() - ($2 || ' seconds')::interval`,
        [stored, String(config.resendWindowSeconds)],
      );
      if ((recent.rows[0]?.count ?? 0) >= 3) return;
      await tx.query('INSERT INTO resend_events (id, email, at) VALUES ($1,$2,now())', [
        randomUUID(),
        stored,
      ]);
      const applications = await tx.query<{ id: string; name: string; title: string }>(
        `SELECT a.id, a.name, r.title
           FROM applications a
           JOIN requisitions r ON r.id = a.requisition_id
          WHERE a.email = $1 AND a.erased_at IS NULL
            AND EXISTS (SELECT 1 FROM tracking_links t
                         WHERE t.application_id = a.id AND t.retired_at IS NULL)
            AND (r.status <> 'closed' OR r.retention_deadline IS NULL
                 OR r.retention_deadline > now())
          ORDER BY a.submitted_at`,
        [stored],
      );
      if (applications.rows.length === 0) return;
      const issued: { roleTitle: string; token: string }[] = [];
      for (const application of applications.rows) {
        issued.push({
          roleTitle: application.title,
          token: await issueTrackingToken(tx, application.id),
        });
      }
      await queueResentLinks(tx, {
        to: { name: applications.rows[0]?.name ?? '', email: stored },
        applications: issued,
      });
    });

    const reply = jsonReply(
      202,
      {
        message:
          "If that address has applied for a role with us, we've sent its tracking links to it.",
      },
      TRACKING_HEADERS,
    );
    if (!ctx.wantsHtml) return reply;
    return candidateFormPage(ctx, reply, {
      email: stored,
      backHref: '/careers',
      backLabel: 'Back to open roles',
    });
  });

  route('GET', '/api/track/:token', 'candidate', async (ctx) => {
    const application = await loadTracked(pool, ctx.params.token as string);
    if (application === undefined) throw errors.trackingNotFound();
    return jsonReply(200, trackingBody(application), TRACKING_HEADERS);
  });

  route('POST', '/api/track/:token/withdraw', 'candidate', async (ctx) => {
    ctx.json();
    const token = ctx.params.token as string;
    const result = await withTransaction(async (tx) => {
      const application = await loadTracked(tx, token);
      if (application === undefined) throw errors.trackingNotFound();
      const locked = await tx.query<{ stage: ApplicationStage; version: number }>(
        'SELECT stage, version FROM applications WHERE id = $1 FOR UPDATE',
        [application.id],
      );
      const current = locked.rows[0];
      if (current === undefined) throw errors.trackingNotFound();
      if (!applicationMoveAllowed(current.stage, 'withdrawn')) {
        throw errors.illegalTransition(current.stage, 'withdrawn');
      }
      const moved = await tx.query<{ stage_changed_at: Date }>(
        `UPDATE applications SET stage='withdrawn', stage_changed_at=now(), version = version + 1
          WHERE id = $1 RETURNING stage_changed_at`,
        [application.id],
      );
      await tx.query(
        `INSERT INTO stage_decisions (id, application_id, from_stage, to_stage, rationale, actor, at)
         VALUES ($1,$2,$3,'withdrawn','Withdrawn by candidate','candidate', now())`,
        [randomUUID(), application.id, current.stage],
      );
      await queueStageNotice(tx, {
        to: { name: application.name, email: application.email },
        roleTitle: application.title,
        stage: 'withdrawn',
        token,
      });
      await appendAuditEntry(tx, {
        actor: 'candidate',
        action: 'application.stage',
        targetType: 'application',
        targetId: application.id,
        detail: {
          reference: application.reference,
          from: current.stage,
          to: 'withdrawn',
          rationale: 'Withdrawn by candidate',
        },
      });
      return {
        ...application,
        stage: 'withdrawn' as ApplicationStage,
        stage_changed_at: moved.rows[0]?.stage_changed_at ?? new Date(),
      };
    });
    return jsonReply(200, trackingBody(result), TRACKING_HEADERS);
  });
}
