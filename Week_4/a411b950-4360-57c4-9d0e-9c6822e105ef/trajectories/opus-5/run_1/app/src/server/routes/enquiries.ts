import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pacingPolicyKey } from '../config.ts';
import { query, withTransaction } from '../db/pool.ts';
import { businessMonth, isMonthKey } from '../../shared/dates.ts';
import { hasAcceptedChannelsAndRate, isMp3, isPdf, probeAudio } from '../domain/audio.ts';
import { linkStatus } from '../domain/linkStatus.ts';
import { isLinkableStatus, type ProjectStatus, PUBLICLY_VISIBLE_SQL } from '../../shared/projectStatus.ts';
import { addressField, isSafeFileName, multiLineField, singleLineField } from '../domain/text.ts';
import { ApiError, conflict, validation, type FieldErrors } from '../errors.ts';
import { sendJson } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import {
  beginIdempotentRequest,
  isValidIdempotencyKey,
  releaseIdempotentRequest,
  storeIdempotentResponse,
} from '../repo/idempotency.ts';
import { readMonth } from '../repo/months.ts';
import { checkPacing, lockPacing } from '../repo/pacing.ts';
import { readSettings } from '../repo/settings.ts';
import { renderAlert, renderReceipt } from '../services/emails.ts';
import { deliverQueued, queueEmail } from '../services/mail.ts';
import { putObject } from '../services/storage.ts';

export const REFERENCE_SIZE_LIMIT = 10_000_000;
const REFERENCE_MAX_DURATION_MS = 600_000;
const STORED_STATUSES = new Set([201, 413, 415, 422]);

const EXTENSIONS = { wav: 'wav', ogg: 'ogg', mp3: 'mp3', pdf: 'pdf' } as const;
type AttachmentKind = keyof typeof EXTENSIONS;

type Attachment = { filename: string; bytes: Buffer; kind: AttachmentKind };
type Reply = { status: number; body: unknown };

function classifyAttachment(bytes: Buffer): AttachmentKind | null {
  const probe = probeAudio(bytes);
  if (probe !== null) {
    if (!hasAcceptedChannelsAndRate(probe)) return null;
    if (probe.durationMs > REFERENCE_MAX_DURATION_MS) return null;
    return probe.format;
  }
  if (isMp3(bytes)) return 'mp3';
  if (isPdf(bytes)) return 'pdf';
  return null;
}

function fingerprintOf(fields: Record<string, string>, file: { filename: string; bytes: Buffer } | null): string {
  const hash = createHash('sha256');
  for (const name of Object.keys(fields).sort()) {
    hash.update(`${name}\u0000${fields[name] as string}\u0000`);
  }
  if (file !== null) {
    hash.update(`attachment\u0000${file.filename}\u0000`);
    hash.update(createHash('sha256').update(file.bytes).digest('hex'));
  }
  return hash.digest('hex');
}

function idempotencyKeyOf(request: IncomingMessage): string | null {
  const header = request.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return null;
  if (!isValidIdempotencyKey(value)) {
    throw validation({ 'Idempotency-Key': 'Use 1 to 100 visible ASCII characters.' });
  }
  return value;
}

function pacedError(retryAfterSeconds: number): ApiError {
  return new ApiError(
    429,
    'rate_limited',
    'You have sent several briefs in a short time.',
    { retry_after_seconds: retryAfterSeconds },
    { 'retry-after': String(retryAfterSeconds) },
  );
}

type ValidFields = {
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferredMonth: string | null;
  projectSlug: string;
  listenToken: string | null;
};

/** A live link decides the project; otherwise only a published public slug is kept. */
async function resolveProjectContext(listenToken: string | null, requestedSlug: string, now: Date): Promise<string> {
  if (listenToken !== null && listenToken !== '') {
    const result = await query<{ slug: string; status: ProjectStatus; expires_at: Date; revoked_at: Date | null }>(
      `SELECT p.slug, p.status, l.expires_at, l.revoked_at
         FROM listening_links l JOIN projects p ON p.id = l.project_id
        WHERE l.token = $1`,
      [listenToken],
    );
    const link = result.rows[0];
    if (link !== undefined && linkStatus(link, now) === 'active' && isLinkableStatus(link.status)) {
      return link.slug;
    }
    return '';
  }
  if (requestedSlug === '') return '';
  const published = await query<{ slug: string }>(
    `SELECT p.slug FROM projects p WHERE p.slug = $1 AND ${PUBLICLY_VISIBLE_SQL}`,
    [requestedSlug],
  );
  return published.rows[0]?.slug ?? '';
}

async function validateFields(fields: Record<string, string>, now: Date): Promise<ValidFields> {
  const errors: FieldErrors = {};
  const name = singleLineField(fields.name ?? '', 1, 120);
  if (!name.ok) errors.name = name.message;
  const email = addressField(fields.email ?? '');
  if (!email.ok) errors.email = email.message;
  const studio = singleLineField(fields.studio ?? '', 1, 120);
  if (!studio.ok) errors.studio = studio.message;
  const brief = multiLineField(fields.brief ?? '', 20, 4_000);
  if (!brief.ok) errors.brief = brief.message;

  const rawMonth = fields.preferred_month ?? '';
  let preferredMonth: string | null = null;
  if (rawMonth !== '') {
    if (!isMonthKey(rawMonth)) {
      errors.preferred_month = 'Use a production month of the form YYYY-MM.';
    } else {
      const settings = await readSettings();
      const month = await readMonth(rawMonth);
      if (month === null || !month.open || rawMonth < businessMonth(now, settings.time_zone)) {
        errors.preferred_month = 'That production month is not open.';
      } else {
        preferredMonth = rawMonth;
      }
    }
  }

  if (Object.keys(errors).length > 0) throw validation(errors);
  return {
    name: (name as { value: string }).value,
    email: (email as { value: string }).value,
    studio: (studio as { value: string }).value,
    brief: (brief as { value: string }).value,
    preferredMonth,
    projectSlug: fields.project_slug ?? '',
    listenToken: fields.listen_token ?? null,
  };
}

async function saveEnquiry(input: {
  fields: ValidFields;
  attachment: Attachment | null;
  clientIp: string;
  now: Date;
}): Promise<Reply> {
  const senderKey = input.fields.email.toLowerCase();
  const settings = await readSettings();
  const projectSlug = await resolveProjectContext(input.fields.listenToken, input.fields.projectSlug, input.now);

  const enquiryId = randomUUID();
  let attachmentId: string | null = null;
  let attachmentKey: string | null = null;
  if (input.attachment !== null) {
    attachmentId = randomUUID();
    attachmentKey = `briefs/${enquiryId}/${attachmentId}.${EXTENSIONS[input.attachment.kind]}`;
    await putObject(attachmentKey, input.attachment.bytes, 'application/octet-stream');
  }

  const saved = await withTransaction(async (client) => {
    await lockPacing(client, senderKey, input.clientIp);
    const decision = await checkPacing(client, { senderKey, ipKey: input.clientIp, now: input.now });
    if (!decision.allowed) return { paced: decision.retryAfterSeconds } as const;

    const generated = await client.query<{ reference: string }>(
      `SELECT 'ENQ-' || lpad(nextval('enquiry_reference_seq')::text, 6, '0') AS reference`,
    );
    const reference = (generated.rows[0] as { reference: string }).reference;

    await client.query(
      `INSERT INTO enquiries (id, reference, name, email, studio, brief, preferred_month, project_slug,
         attachment_id, attachment_filename, attachment_bytes, attachment_key, sender_key, ip_key, pacing_policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        enquiryId,
        reference,
        input.fields.name,
        input.fields.email,
        input.fields.studio,
        input.fields.brief,
        input.fields.preferredMonth,
        projectSlug,
        attachmentId,
        input.attachment?.filename ?? null,
        input.attachment?.bytes.byteLength ?? null,
        attachmentKey,
        senderKey,
        input.clientIp,
        pacingPolicyKey,
      ],
    );

    const receiptId = await queueEmail(client, {
      kind: 'receipt',
      enquiryId,
      reference,
      message: renderReceipt({
        name: input.fields.name,
        email: input.fields.email,
        reference,
        brief: input.fields.brief,
        queuedAt: input.now,
      }),
    });
    const alertId = await queueEmail(client, {
      kind: 'alert',
      enquiryId,
      reference,
      message: renderAlert({
        operatorEmail: settings.operator_email,
        name: input.fields.name,
        email: input.fields.email,
        studio: input.fields.studio,
        reference,
        brief: input.fields.brief,
        projectSlug,
        preferredMonth: input.fields.preferredMonth,
        queuedAt: input.now,
      }),
    });
    return { reference, receiptId, alertId } as const;
  });

  if ('paced' in saved) throw pacedError(saved.paced as number);

  const receipt = await deliverQueued(saved.receiptId);
  await deliverQueued(saved.alertId);
  return {
    status: 201,
    body: { reference: saved.reference, status: 'new', receipt: receipt === 'sent' ? 'sent' : 'pending' },
  };
}

async function handleBrief(
  fields: Record<string, string>,
  attachment: { filename: string; bytes: Buffer } | null,
  clientIp: string,
  now: Date,
): Promise<Reply> {
  const senderKey = (fields.email ?? '').toLowerCase();
  const decision = await checkPacing({ query }, { senderKey, ipKey: clientIp, now });
  if (!decision.allowed) throw pacedError(decision.retryAfterSeconds);

  let checked: Attachment | null = null;
  if (attachment !== null) {
    if (attachment.bytes.byteLength > REFERENCE_SIZE_LIMIT) {
      throw new ApiError(413, 'file_too_large', `That file is over ${REFERENCE_SIZE_LIMIT} bytes.`);
    }
    const kind = classifyAttachment(attachment.bytes);
    if (kind === null) throw new ApiError(415, 'unsupported_media', 'Send a WAV, OGG, MP3 or PDF reference file.');
    if (!isSafeFileName(attachment.filename)) throw validation({ attachment: 'File name is not allowed.' });
    checked = { filename: attachment.filename, bytes: attachment.bytes, kind };
  }

  const valid = await validateFields(fields, now);
  return saveEnquiry({ fields: valid, attachment: checked, clientIp, now });
}

export const enquiryRoutes: readonly Route[] = [
  {
    path: '/api/enquiries',
    method: 'POST',
    body: 'enquiry-multipart',
    handler: async ({ request, response, multipart, clientIp, now }) => {
      const fields = multipart?.fields ?? {};
      const file = multipart?.file ?? null;
      const attachment = file !== null && file.field === 'attachment' && file.bytes.byteLength > 0 ? file : null;
      const idempotencyKey = idempotencyKeyOf(request);

      if (idempotencyKey === null) {
        const reply = await handleBrief(fields, attachment, clientIp, now);
        sendJson(response, reply.status, reply.body);
        return;
      }

      const lookup = await beginIdempotentRequest('brief', idempotencyKey, fingerprintOf(fields, attachment));
      if (lookup.kind === 'stored') {
        sendJson(response, lookup.status, lookup.body);
        return;
      }
      if (lookup.kind === 'conflict') {
        throw conflict('idempotency_conflict', 'That idempotency key was used for a different brief.');
      }
      if (lookup.kind === 'in_progress') {
        throw conflict('request_in_progress', 'That brief is still being sent.');
      }

      try {
        const reply = await handleBrief(fields, attachment, clientIp, now);
        await storeIdempotentResponse('brief', idempotencyKey, reply.status, reply.body);
        sendJson(response, reply.status, reply.body);
      } catch (error) {
        if (error instanceof ApiError && STORED_STATUSES.has(error.status)) {
          await storeIdempotentResponse('brief', idempotencyKey, error.status, error.body());
        } else {
          await releaseIdempotentRequest('brief', idempotencyKey);
        }
        throw error;
      }
    },
  },
];
