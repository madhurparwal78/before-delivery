import type { RequestCtx } from './dispatch.js';
import { multipartMaxBytes } from './dispatch.js';
import { errors, ApiError } from '../platform/errors.js';
import { sendJson, sendHtml, sendBytes, readBody } from './plumbing.js';
import { escapeHtml, trim, normalizeEmail, isValidCandidateEmail, isValidCandidateName, codePoints } from '../domain/text.js';
import { config } from '../config.js';
import { formatLondon, londonToday } from '../domain/time.js';
import { STAGE_LABELS, STAGE_ORDER, type ApplicationStage } from '../domain/lifecycles.js';
import { htmlPageHeaders, pageHtml, notFoundPage, gonePage, resendFormHtml } from '../html/shell.js';
import { putObject } from '../platform/storage.js';
import { withTransaction } from '../platform/db.js';
import { writeAudit } from '../platform/audit.js';
import { randomToken, tokenDigest } from '../platform/crypto.js';
import { createHash, randomBytes } from 'node:crypto';
import { IdempotencyScope, multipartFingerprint } from '../platform/idempotency.js';
import { queueMail } from './jobs.js';

export async function handleCandidate(ctx: RequestCtx): Promise<void> {
  const { method, path } = ctx;
  const applyMatch = /^\/api\/careers\/roles\/([^/]+)\/applications$/.exec(path);
  if (applyMatch && method === 'POST') {
    return submitApplication(ctx, applyMatch[1]);
  }
  if (path === '/api/careers/tracking-links' && method === 'POST') {
    return resendLinks(ctx);
  }
  const trackMatch = /^\/api\/track\/([^/]+)$/.exec(path);
  if (trackMatch && method === 'GET') {
    return trackingApi(ctx, trackMatch[1]);
  }
  const withdrawMatch = /^\/api\/track\/([^/]+)\/withdraw$/.exec(path);
  if (withdrawMatch && method === 'POST') {
    return withdrawApplication(ctx, withdrawMatch[1]);
  }
  const pageMatch = /^\/track\/([^/]+)$/.exec(path);
  if (pageMatch && method === 'GET') {
    return trackingPage(ctx, pageMatch[1]);
  }
  throw errors.notFoundPublic();
}

// ---------------------------------------------------------------------------
// Multipart parsing

type MultipartResult = {
  ok: boolean;
  tooLarge?: boolean;
  fields: Record<string, string>;
  file?: { name: string; data: Buffer };
};

function parseMultipart(body: Buffer, boundary: string): MultipartResult {
  const fields: Record<string, string> = {};
  let file: { name: string; data: Buffer } | undefined;
  const dashDash = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let idx = body.indexOf(dashDash);
  if (idx === -1) return { ok: false, fields };
  while (idx !== -1) {
    const next = body.indexOf(dashDash, idx + dashDash.length);
    if (next === -1) break;
    const part = body.slice(idx + dashDash.length, next);
    if (part.length > 0 && part[0] === 0x0d && part[1] === 0x0a) {
      parts.push(part.slice(2, part.length - 2));
    }
    idx = next;
  }
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd).toString('utf8');
    const data = part.slice(headerEnd + 4);
    const nameMatch = /name="([^"]*)"/.exec(headers);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const isFile = /filename=/.test(headers);
    if (isFile) {
      const fileNameMatch = /filename="([^"]*)"/.exec(headers);
      file = { name: fileNameMatch?.[1] ?? '', data };
    } else {
      fields[name] = data.toString('utf8');
    }
  }
  return { ok: true, fields, file };
}

// ---------------------------------------------------------------------------
// Application submission

async function submitApplication(ctx: RequestCtx, roleSlug: string): Promise<void> {
  const contentType = ctx.req.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    throw errors.unsupportedMediaType(true);
  }
  const boundaryMatch = /boundary=([^;]+)/.exec(contentType);
  if (!boundaryMatch) {
    throw errors.unsupportedMediaType(true);
  }
  const body = await readBody(ctx.req, multipartMaxBytes());
  if (!body.ok) {
    if (body.tooLarge) throw errors.payloadTooLarge();
    throw errors.unsupportedMediaType(true);
  }
  const parsed = parseMultipart(body.body, boundaryMatch[1].trim().replace(/^"|"$/g, ''));
  if (!parsed.ok) throw errors.unsupportedMediaType(true);
  const fields = parsed.fields;
  const file = parsed.file;
  const name = trim(String(fields.name ?? ''));
  const emailRaw = String(fields.email ?? '');
  const email = normalizeEmail(emailRaw);
  const consent = String(fields.consent ?? '');
  const fieldErrors: Record<string, string> = {};
  if (!isValidCandidateName(name)) fieldErrors.name = 'Enter your full name.';
  if (!isValidCandidateEmail(email)) fieldErrors.email = 'Enter a valid email address.';
  if (consent !== 'yes') fieldErrors.consent = 'Please confirm your consent to apply.';
  const fileData: Buffer | null = file && file.data.length >= 1 ? file.data : null;
  if (!fileData || fileData.length > 5000000 || !isPdf(fileData)) {
    fieldErrors.resume = 'Attach a PDF résumé of at most 5,000,000 bytes.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw errors.validation(fieldErrors);
  }
  const resumeBytes: Buffer = fileData as Buffer;

  // Role must exist and be open.
  const role = await ctx.client.query<{ id: string; slug: string; title: string; office: string; status: string }>(
    `SELECT r.id, r.slug, r.title, r.office, r.status, o.label AS office_label
     FROM requisitions r JOIN offices o ON o.slug = r.office WHERE r.slug = $1`,
    [roleSlug],
  );
  const roleRow = role.rows[0];
  if (!roleRow || roleRow.status !== 'open') {
    if (roleRow && roleRow.status === 'closed') {
      throw new ApiError(409, 'requisition_closed', 'This role is no longer accepting applications.');
    }
    throw errors.notFoundPublic();
  }

  // Duplicate check before anything else.
  const existing = await ctx.client.query<{ id: string; reference: string; stage: string; submitted_at: Date }>(
    `SELECT id, reference, stage, submitted_at FROM applications
     WHERE requisition_id = $1 AND email = $2`,
    [roleRow.id, email],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return sendJson(ctx.res, 200, {
      application: {
        reference: row.reference,
        role: { slug: roleRow.slug, title: roleRow.title },
        stage: row.stage,
        submitted_at: new Date(row.submitted_at).toISOString(),
      },
    }, ctx.rateHeaders);
  }

  // Storage check first: if the résumé cannot be stored, nothing is recorded.
  const objectKey = `resumes/${roleRow.id}/${randomBytes(16).toString('hex')}.pdf`;
  const put = await putObject(objectKey, resumeBytes, 'application/pdf');
  if (!put.ok) {
    throw new ApiError(503, 'storage_unavailable', "We couldn't store your résumé just now. Nothing was submitted; please try again in a few minutes.");
  }

  const scope = `role:${roleSlug}`;
  const idem = new IdempotencyScope(scope);
  const keyHeader = ctx.req.headers['idempotency-key'];
  const key = typeof keyHeader === 'string' && keyHeader !== '' ? keyHeader : null;
  const fingerprint = multipartFingerprint(
    ctx.method,
    ctx.path,
    { name, email, consent },
    createHash('sha256').update(resumeBytes).digest('hex'),
  );
  let storedResponse: { status: number; body: unknown } | null = null;
  try {
    const result = await withTransaction(async (client) => {
      const r = key ? await idem.begin(client, key, fingerprint) : { replay: null };
      if (r.replay) {
        return r.replay;
      }
      // Race-safe duplicate insert: the unique key on (requisition_id, email) settles it.
      const reference = makeReference();
      const token = randomToken(32);
      let inserted: { id: string } | null = null;
      try {
        const res = await client.query(
          `INSERT INTO applications (requisition_id, reference, name, email, stage, resume_key, token_digest, submitted_at)
           VALUES ($1, $2, $3, $4, 'submitted', $5, $6, now())
           ON CONFLICT (requisition_id, email) DO NOTHING
           RETURNING id`,
          [roleRow.id, reference, name, email, objectKey, tokenDigest(token)],
        );
        inserted = res.rows[0] ?? null;
      } catch {
        inserted = null;
      }
      if (!inserted) {
        const row = await client.query<{ id: string; reference: string; stage: string; submitted_at: Date }>(
          `SELECT id, reference, stage, submitted_at FROM applications WHERE requisition_id = $1 AND email = $2`,
          [roleRow.id, email],
        );
        const original = row.rows[0];
        return {
          status: 200,
          body: {
            application: {
              reference: original.reference,
              role: { slug: roleRow.slug, title: roleRow.title },
              stage: original.stage,
              submitted_at: new Date(original.submitted_at).toISOString(),
            },
          },
        };
      }
      const applicationId = inserted.id;
      await queueMail(client, {
        to: { name, email },
        subject: `Application received: ${roleRow.title}`,
        body: `Dear ${name},\n\nWe have received your application for "${roleRow.title}".\n\nYour reference is ${reference}.\n\nYou can follow your application here:\n${config.publicBaseUrl}/track/${token}\n\nIf you lose this link, you can ask for a new one from the careers page.`,
      });
      await writeAudit(client, {
        actor: 'candidate',
        action: 'application.stage',
        targetType: 'application',
        targetId: applicationId,
        detail: { reference, to: 'submitted', from: 'none' },
      });
      const body = {
        application: {
          reference,
          role: { slug: roleRow.slug, title: roleRow.title },
          stage: 'submitted',
          submitted_at: new Date().toISOString(),
        },
      };
      if (key) await idem.finish(client, 201, body);
      return { status: 201, body };
    });
    storedResponse = result;
  } catch (e) {
    // Rollback removes the DB row; the stored object must go too.
    try {
      const { deleteObject } = await import('../platform/storage.js');
      await deleteObject(objectKey);
    } catch {
      /* best effort */
    }
    if (key) {
      try {
        await withTransaction(async (client) => {
          await idem.abandon(client);
        });
      } catch {
        /* best effort */
      }
    }
    throw e;
  }
  if (storedResponse.status >= 500) {
    try {
      const { deleteObject } = await import('../platform/storage.js');
      await deleteObject(objectKey);
    } catch {
      /* best effort */
    }
  }
  const headers = { ...ctx.rateHeaders } as Record<string, string>;
  if (key) headers['Idempotency-Replayed'] = 'false';
  sendJson(ctx.res, storedResponse.status, storedResponse.body, headers);
}

function isPdf(data: Buffer): boolean {
  return data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-';
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeReference(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  }
  return `AR-${out}`;
}

// ---------------------------------------------------------------------------
// Re-send links

async function resendLinks(ctx: RequestCtx): Promise<void> {
  const body = await readBody(ctx.req, 100000);
  if (!body.ok) {
    if (body.tooLarge) throw errors.payloadTooLarge();
    throw errors.unsupportedMediaType(false);
  }
  const contentType = ctx.req.headers['content-type'] ?? '';
  if (!contentType.includes('application/json')) {
    throw errors.unsupportedMediaType(false);
  }
  let payload: Record<string, unknown> = {};
  try {
    const text = body.body.toString('utf8').trim();
    if (text !== '') payload = JSON.parse(text);
  } catch {
    throw errors.unsupportedMediaType(false);
  }
  const emailRaw = typeof payload.email === 'string' ? payload.email : '';
  const email = normalizeEmail(emailRaw);
  if (!isValidCandidateEmail(email)) {
    throw errors.validation({ email: 'Enter a valid email address.' });
  }
  // Throttle: at most three re-send emails per rolling window.
  const throttled = await withTransaction(async (client) => {
    const now = new Date();
    const rows = await client.query<{ window_start: Date; count: number }>(
      `SELECT window_start, count FROM resend_counts WHERE email = $1 FOR UPDATE`,
      [email],
    );
    const row = rows.rows[0];
    if (row) {
      const windowEnd = new Date(new Date(row.window_start).getTime() + config.resendWindowSeconds * 1000);
      if (windowEnd.getTime() > now.getTime()) {
        if (row.count >= 3) return true;
        await client.query(
          `UPDATE resend_counts SET count = count + 1 WHERE email = $1`,
          [email],
        );
        return false;
      }
    }
    await client.query(
      `INSERT INTO resend_counts (email, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (email) DO UPDATE SET window_start = $2, count = 1`,
      [email, now.toISOString()],
    );
    return false;
  });
  if (!throttled) {
    await withTransaction(async (client) => {
      const apps = await client.query<{
        id: string;
        name: string;
        email: string;
        stage: string;
        title: string;
        req_status: string;
        retention_deadline: Date | null;
      }>(
        `SELECT a.id, a.name, a.email, a.stage, r.title, r.status AS req_status, r.retention_deadline
         FROM applications a JOIN requisitions r ON r.id = a.requisition_id
         WHERE a.email = $1`,
        [email],
      );
      const live: Array<{ title: string; token: string }> = [];
      for (const app of apps.rows) {
        const deadline = app.retention_deadline;
        const expired = app.req_status === 'closed' && deadline && new Date(deadline).getTime() < Date.now();
        if (expired) continue;
        const token = randomToken(32);
        await client.query(`UPDATE applications SET token_digest = $1 WHERE id = $2`, [
          tokenDigest(token),
          app.id,
        ]);
        live.push({ title: app.title, token });
      }
      if (live.length > 0) {
        await queueMail(client, {
          to: { name: apps.rows[0].name, email: apps.rows[0].email },
          subject: 'Your Aldermoor application links',
          body: `Here are your tracking links:\n${live.map((l) => `- ${l.title}: ${config.publicBaseUrl}/track/${l.token}`).join('\n')}`,
        });
      }
    });
  }
  sendJson(ctx.res, 202, {
    message: "If that address has applied for a role with us, we've sent its tracking links to it.",
  }, ctx.rateHeaders);
}

// ---------------------------------------------------------------------------
// Tracking

type TrackingApp = {
  id: string;
  reference: string;
  name: string;
  email: string;
  stage: string;
  stage_changed_at: Date;
  submitted_at: Date;
  version: number;
  req_status: string;
  req_title: string;
  req_office: string;
  retention_deadline: Date | null;
};

async function trackingApp(ctx: RequestCtx, token: string): Promise<TrackingApp | null> {
  const rows = await ctx.client.query<TrackingApp>(
    `SELECT a.id, a.reference, a.name, a.email, a.stage, a.stage_changed_at, a.submitted_at, a.version,
            r.status AS req_status, r.title AS req_title, r.office AS req_office, r.retention_deadline
     FROM applications a JOIN requisitions r ON r.id = a.requisition_id
     WHERE a.token_digest = $1`,
    [tokenDigest(token)],
  );
  const row = rows.rows[0];
  if (!row) return null;
  if (row.req_status === 'closed') {
    if (row.retention_deadline && new Date(row.retention_deadline).getTime() < Date.now()) {
      return null;
    }
  }
  return row;
}

async function trackingApi(ctx: RequestCtx, token: string): Promise<void> {
  const app = await trackingApp(ctx, token);
  if (!app) throw errors.notFoundPublic();
  const officeRows = await ctx.client.query<{ label: string }>(`SELECT label FROM offices WHERE slug = $1`, [app.req_office]);
  sendJson(ctx.res, 200, {
    role: { title: app.req_title, office: officeRows.rows[0]?.label ?? app.req_office },
    stage: app.stage,
    stage_label: STAGE_LABELS[app.stage as keyof typeof STAGE_LABELS],
    submitted_at: new Date(app.submitted_at).toISOString(),
    stage_changed_at: new Date(app.stage_changed_at).toISOString(),
  }, {
    ...ctx.rateHeaders,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
}

async function withdrawApplication(ctx: RequestCtx, token: string): Promise<void> {
  const body = await readBody(ctx.req, 100000);
  if (!body.ok) {
    if (body.tooLarge) throw errors.payloadTooLarge();
  }
  const app = await trackingApp(ctx, token);
  if (!app) throw errors.notFoundPublic();
  if (app.stage === 'offer' || app.stage === 'declined' || app.stage === 'withdrawn') {
    throw errors.illegalTransition(app.stage, 'withdrawn');
  }
  await withTransaction(async (client) => {
    const locked = await client.query<{ stage: string }>(
      `SELECT stage FROM applications WHERE id = $1 FOR UPDATE`,
      [app.id],
    );
    const current = locked.rows[0];
    if (!current) throw errors.notFoundPublic();
    if (current.stage === 'offer' || current.stage === 'declined' || current.stage === 'withdrawn') {
      throw errors.illegalTransition(current.stage, 'withdrawn');
    }
    await client.query(
      `UPDATE applications SET stage = 'withdrawn', stage_changed_at = now(), version = version + 1 WHERE id = $1`,
      [app.id],
    );
    await client.query(
      `INSERT INTO stage_decisions (application_id, from_stage, to_stage, rationale, by_email)
       VALUES ($1, $2, 'withdrawn', 'Withdrawn by candidate', 'candidate')`,
      [app.id, current.stage],
    );
    await writeAudit(client, {
      actor: 'candidate',
      action: 'application.stage',
      targetType: 'application',
      targetId: app.id,
      detail: { reference: app.reference, to: 'withdrawn' },
    });
  });
  const refreshed = await trackingApp(ctx, token);
  const officeRows = await ctx.client.query<{ label: string }>(`SELECT label FROM offices WHERE slug = $1`, [refreshed?.req_office ?? '']);
  sendJson(ctx.res, 200, {
    role: { title: refreshed?.req_title ?? '', office: officeRows.rows[0]?.label ?? '' },
    stage: 'withdrawn',
    stage_label: STAGE_LABELS.withdrawn,
    submitted_at: new Date(refreshed?.submitted_at ?? Date.now()).toISOString(),
    stage_changed_at: new Date().toISOString(),
  }, {
    ...ctx.rateHeaders,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
}

async function trackingPage(ctx: RequestCtx, token: string): Promise<void> {
  const app = await trackingApp(ctx, token);
  if (!app) {
    sendHtml(ctx.res, 404, notFoundPage('link'), {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    return;
  }
  const officeRows = await ctx.client.query<{ label: string }>(`SELECT label FROM offices WHERE slug = $1`, [app.req_office]);
  const office = officeRows.rows[0]?.label ?? app.req_office;
  const currentStep = STAGE_ORDER.indexOf(app.stage as ApplicationStage);
  const steps = [
    'submitted',
    'screening',
    'interview',
    'final_review',
    'offer',
    ...(app.stage === 'declined' || app.stage === 'withdrawn' ? [app.stage] : []),
  ]
    .map((stage, index) => {
      const isCurrent = stage === app.stage;
      const done = STAGE_ORDER.indexOf(stage as ApplicationStage) >= 0 && currentStep >= 0
        ? STAGE_ORDER.indexOf(stage as ApplicationStage) < currentStep
        : false;
      return `<li class="stage-step${isCurrent ? ' current' : done ? ' done' : ''}"${isCurrent ? ' aria-current="step"' : ''}>
        <span class="stage-step-num mono">${index + 1}</span>
        <span class="stage-step-label">${escapeHtml(STAGE_LABELS[stage as keyof typeof STAGE_LABELS])}</span>
      </li>`;
    })
    .join('\n');
  const active = !['offer', 'declined', 'withdrawn'].includes(app.stage);
  const body = `<section class="tracking">
    <h1 class="display">${escapeHtml(app.req_title)}</h1>
    <p class="tracking-office">${escapeHtml(office)}</p>
    <p class="tracking-stage">Current stage: <strong>${escapeHtml(STAGE_LABELS[app.stage as keyof typeof STAGE_LABELS])}</strong></p>
    <ol class="stage-progress" aria-label="Stage progress">
${steps}
    </ol>
    <p class="tracking-dates">Submitted <span class="mono">${escapeHtml(formatLondon(new Date(app.submitted_at)))}</span> · Last changed <span class="mono">${escapeHtml(formatLondon(new Date(app.stage_changed_at)))}</span></p>
    ${active ? `<button type="button" class="button danger" id="withdraw-button">Withdraw application</button>
    <div class="dialog-backdrop" id="withdraw-dialog" hidden>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="withdraw-dialog-title" aria-label="Withdraw application?">
        <h2 class="dialog-title" id="withdraw-dialog-title">Withdraw application?</h2>
        <p>This cannot be undone. Your application will end here.</p>
        <div class="dialog-actions">
          <button type="button" class="button danger" id="confirm-withdraw">Withdraw</button>
          <button type="button" class="button subtle" id="keep-application">Keep my application</button>
        </div>
      </div>
    </div>` : ''}
    <p class="status" id="application-status" role="status" aria-live="polite"></p>
  </section>`;
  sendHtml(ctx.res, 200, pageHtml({
    title: `${app.req_title} — your application — Aldermoor Open Record`,
    description: 'Follow your application to Aldermoor Labs.',
    body,
    bodyClass: 'public tracking-page',
    inlineData: JSON.stringify({ token }),
  }), {
    ...htmlPageHeaders(ctx.rateHeaders),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
}
