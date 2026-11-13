import type { RequestCtx } from './dispatch.js';
import { jsonMaxBytes } from './dispatch.js';
import { errors, ApiError } from '../platform/errors.js';
import { sendJson, readBody, parseJsonBody, ifMatchVersion, etagFor, redirect } from './plumbing.js';
import {
  signIn,
  createSession,
  deleteSession,
  hasRole,
  staffByEmail,
  type StaffRole,
} from './session.js';
import { verifyPassword, randomToken } from '../platform/crypto.js';
import { withTransaction } from '../platform/db.js';
import { writeAudit, verifyAuditChain, canonicalJson } from '../platform/audit.js';
import { config } from '../config.js';
import {
  readOnlyFieldsFor,
  validateContentFields,
  slugInUse,
  insertContent,
  updateContentFields,
  transitionContent,
  getContentById,
  contentToView,
  loadComments,
  CONTENT_EDITABLE_KEYS,
  type ContentRow,
} from './content.js';
import {
  recordSignoff,
  runClaimValidation,
  getReleaseRecord,
  checkSignoffLapse,
  voidSignoffsFor,
  viewReleaseRecord,
  recordStatus,
} from './release-record.js';
import {
  queueJob,
  retryDeadJob,
  jobView,
  type JobRow,
  queueMail,
} from './jobs.js';
import { IdempotencyScope, jsonFingerprint } from '../platform/idempotency.js';
import {
  applicationCanMove,
  requisitionCanMove,
  type ApplicationStage,
  type ContentKind,
  type ContentStatus,
  STAGE_LABELS,
  ACTIVE_STAGES,
} from '../domain/lifecycles.js';
import { trim, codePoints, isValidSlug, limitText, isValidScore, escapeHtml } from '../domain/text.js';
import { parseLondonTime, isValidDate, formatLondon } from '../domain/time.js';
import { renderConsolePage } from '../html/console.js';
import { refreshSearchIndex, indexContentItem } from '../db/migrate.js';
import { tokenDigest } from '../platform/crypto.js';
import { readTimeMinutes } from '../domain/lifecycles.js';

function requireSession(ctx: RequestCtx): NonNullable<RequestCtx['session']> {
  if (!ctx.session) throw errors.unauthenticated();
  return ctx.session;
}

function requireRole(ctx: RequestCtx, role: StaffRole): NonNullable<RequestCtx['session']> {
  const session = requireSession(ctx);
  if (!hasRole(session, role)) throw errors.forbidden();
  return session;
}

function requireAnyRole(ctx: RequestCtx, roles: StaffRole[]): NonNullable<RequestCtx['session']> {
  const session = requireSession(ctx);
  if (!roles.some((r) => hasRole(session, r))) throw errors.forbidden();
  return session;
}

async function readJson(ctx: RequestCtx): Promise<Record<string, unknown>> {
  const contentType = ctx.req.headers['content-type'] ?? '';
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return {};
  const body = await readBody(ctx.req, jsonMaxBytes());
  if (!body.ok) {
    if (body.tooLarge) throw errors.payloadTooLarge();
    throw errors.unsupportedMediaType(false);
  }
  const text = body.body.toString('utf8');
  if (contentType.includes('application/json')) {
    const parsed = parseJsonBody(text);
    if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      throw errors.unsupportedMediaType(false);
    }
    return parsed.value as Record<string, unknown>;
  }
  // A body listed as {} may also arrive with no body at all, whatever the
  // declared content type.
  if (text.trim() === '') {
    return {};
  }
  if (contentType.includes('multipart')) {
    throw errors.unsupportedMediaType(true);
  }
  throw errors.unsupportedMediaType(false);
}

export async function handleConsole(ctx: RequestCtx): Promise<void> {
  const { method, path } = ctx;

  // Sign-in and session.
  if (path === '/api/console/session' && method === 'POST') {
    return signInRoute(ctx);
  }
  if (path === '/api/console/session' && method === 'DELETE') {
    return signOutRoute(ctx);
  }
  if (path === '/api/console/me') {
    const session = requireSession(ctx);
    return sendJson(ctx.res, 200, {
      email: session.email,
      name: session.name,
      roles: session.grants,
    }, ctx.rateHeaders);
  }

  // Grants.
  if (path === '/api/console/grants' && method === 'GET') {
    requireRole(ctx, 'administrator');
    const rows = await ctx.client.query(
      `SELECT id, staff_email, role, granted_by, granted_at, expires_at, revoked_at, revoked_by, version
       FROM grants ORDER BY granted_at DESC`,
    );
    const grants = rows.rows.map((g) => ({
      ...g,
      granted_at: new Date(g.granted_at).toISOString(),
      expires_at: new Date(g.expires_at).toISOString(),
      revoked_at: g.revoked_at ? new Date(g.revoked_at).toISOString() : null,
      status: grantStatus(g),
    }));
    return sendJson(ctx.res, 200, { grants }, ctx.rateHeaders);
  }
  if (path === '/api/console/grants' && method === 'POST') {
    return createGrant(ctx);
  }
  const revokeMatch = /^\/api\/console\/grants\/([^/]+)\/revoke$/.exec(path);
  if (revokeMatch && method === 'POST') {
    return revokeGrant(ctx, revokeMatch[1]);
  }

  // Audit.
  if (path === '/api/console/audit' && method === 'GET') {
    requireRole(ctx, 'administrator');
    const action = ctx.query.get('action') ?? undefined;
    const targetId = ctx.query.get('target_id') ?? undefined;
    const beforeSeq = ctx.query.get('before_seq');
    const limitRaw = ctx.query.get('limit');
    let limit = 100;
    if (limitRaw !== null) {
      limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw errors.validation({ limit: 'Choose a limit from 1 to 500.' });
      }
    }
    const params: unknown[] = [];
    const where: string[] = [];
    if (action) {
      params.push(action);
      where.push(`action = $${params.length}`);
    }
    if (targetId) {
      params.push(targetId);
      where.push(`target_id = $${params.length}`);
    }
    if (beforeSeq !== null && beforeSeq !== '') {
      const n = Number(beforeSeq);
      if (Number.isInteger(n)) {
        params.push(n);
        where.push(`seq < $${params.length}`);
      }
    }
    params.push(limit);
    const rows = await ctx.client.query(
      `SELECT seq, id, at, actor, action, target_type, target_id, detail, prev_hash, hash
       FROM audit_entries ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY seq DESC LIMIT $${params.length}`,
      params,
    );
    const entries = rows.rows.map((r) => ({
      seq: Number(r.seq),
      id: r.id,
      at: new Date(r.at).toISOString(),
      actor: r.actor,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      detail: r.detail,
      prev_hash: r.prev_hash,
      hash: r.hash,
    }));
    return sendJson(ctx.res, 200, { entries }, ctx.rateHeaders);
  }
  if (path === '/api/console/audit/verify') {
    requireRole(ctx, 'administrator');
    const result = await verifyAuditChain(ctx.client);
    return sendJson(ctx.res, 200, result, ctx.rateHeaders);
  }
  if (path.startsWith('/api/console/audit/') && ['PUT', 'PATCH', 'DELETE'].includes(method)) {
    requireSession(ctx);
    throw new ApiError(405, 'audit_immutable', 'Audit entries cannot be changed or removed.');
  }

  // Jobs.
  if (path === '/api/console/jobs' && method === 'GET') {
    requireRole(ctx, 'administrator');
    const state = ctx.query.get('state') ?? undefined;
    const kind = ctx.query.get('kind') ?? undefined;
    const params: unknown[] = [];
    const where: string[] = [];
    if (state) {
      params.push(state);
      where.push(`state = $${params.length}`);
    }
    if (kind) {
      params.push(kind);
      where.push(`kind = $${params.length}`);
    }
    const rows = await ctx.client.query<JobRow & { payload: unknown }>(
      `SELECT * FROM jobs ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    return sendJson(ctx.res, 200, { jobs: rows.rows.map((r) => jobView(r)) }, ctx.rateHeaders);
  }
  const retryMatch = /^\/api\/console\/jobs\/([^/]+)\/retry$/.exec(path);
  if (retryMatch && method === 'POST') {
    const session = requireRole(ctx, 'administrator');
    await readJson(ctx);
    await withTransaction(async (client) => {
      await retryDeadJob(client, retryMatch[1], session.email);
    });
    const rows = await ctx.client.query<JobRow & { payload: unknown }>(
      `SELECT * FROM jobs WHERE id = $1`,
      [retryMatch[1]],
    );
    return sendJson(ctx.res, 200, { job: jobView(rows.rows[0]) }, ctx.rateHeaders);
  }

  // Content.
  if (path === '/api/console/content' && method === 'GET') {
    requireAnyRole(ctx, ['editor', 'approver']);
    const status = ctx.query.get('status') ?? undefined;
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $1`;
    }
    const rows = await ctx.client.query(
      `SELECT * FROM content_items ${where} ORDER BY created_at DESC`,
      params,
    );
    const items: unknown[] = [];
    for (const row of rows.rows) {
      const content = await getContentById(ctx.client, row.id);
      if (content) {
        const comments = await loadComments(ctx.client, content.id);
        const view = contentToView(content);
        view.comments = comments;
        items.push(view);
      }
    }
    return sendJson(ctx.res, 200, { items }, ctx.rateHeaders);
  }
  if (path === '/api/console/content' && method === 'POST') {
    return createContent(ctx);
  }
  const contentMatch = /^\/api\/console\/content\/([^/]+)$/.exec(path);
  if (contentMatch) {
    if (method === 'GET') return getContent(ctx, contentMatch[1]);
    if (method === 'PATCH') return patchContent(ctx, contentMatch[1]);
  }
  const actionMatch = /^\/api\/console\/content\/([^/]+)\/(submit|approve|return|schedule|release|withdraw|comments)$/.exec(path);
  if (actionMatch) {
    const [, id, action] = actionMatch;
    switch (action) {
      case 'submit': return submitContent(ctx, id);
      case 'approve': return approveContent(ctx, id);
      case 'return': return returnContent(ctx, id);
      case 'schedule': return scheduleContent(ctx, id);
      case 'release': return releaseContent(ctx, id);
      case 'withdraw': return withdrawContent(ctx, id);
      case 'comments': return addComment(ctx, id);
    }
  }
  const releaseMatch = /^\/api\/console\/content\/([^/]+)\/release-record(?:\/(signoffs|validate-claims|clear))?$/.exec(path);
  if (releaseMatch) {
    const [, id, sub] = releaseMatch;
    if (!sub && method === 'GET') return getReleaseRecordRoute(ctx, id);
    if (sub === 'signoffs' && method === 'POST') return recordSignoffRoute(ctx, id);
    if (sub === 'validate-claims' && method === 'POST') return validateClaimsRoute(ctx, id);
    if (sub === 'clear' && method === 'POST') return clearReleaseRoute(ctx, id);
  }

  // Benchmark rows.
  if (path === '/api/console/benchmark-rows' && method === 'GET') {
    requireAnyRole(ctx, ['editor', 'approver']);
    const rows = await ctx.client.query(
      `SELECT * FROM benchmark_rows ORDER BY benchmark, eval_date, subject`,
    );
    return sendJson(ctx.res, 200, { rows: rows.rows }, ctx.rateHeaders);
  }
  if (path === '/api/console/benchmark-rows' && method === 'POST') {
    return createBenchmarkRow(ctx);
  }
  const rowMatch = /^\/api\/console\/benchmark-rows\/([^/]+)$/.exec(path);
  if (rowMatch && ['PATCH', 'DELETE', 'PUT'].includes(method)) {
    requireSession(ctx);
    throw new ApiError(405, 'rows_immutable', 'Recorded rows cannot be changed.');
  }

  // Requisitions, applications, benefits.
  if (path === '/api/console/requisitions' && method === 'GET') {
    return listRequisitions(ctx);
  }
  if (path === '/api/console/requisitions' && method === 'POST') {
    return createRequisition(ctx);
  }
  const reqMatch = /^\/api\/console\/requisitions\/([^/]+)(?:\/(open|close|applications))?$/.exec(path);
  if (reqMatch) {
    const [, id, sub] = reqMatch;
    if (!sub && method === 'GET') return getRequisition(ctx, id);
    if (sub === 'open' && method === 'POST') return openRequisition(ctx, id);
    if (sub === 'close' && method === 'POST') return closeRequisition(ctx, id);
    if (sub === 'applications' && method === 'GET') return listApplications(ctx, id);
  }
  const appMatch = /^\/api\/console\/applications\/([^/]+)(?:\/(stage|notes|resume|tracking-link\/reissue))?$/.exec(path);
  if (appMatch) {
    const [, id, sub] = appMatch;
    if (!sub && method === 'GET') return getApplication(ctx, id);
    if (sub === 'stage' && method === 'POST') return moveApplicationStage(ctx, id);
    if (sub === 'notes' && method === 'POST') return addApplicationNote(ctx, id);
    if (sub === 'resume' && method === 'GET') return downloadResume(ctx, id);
    if (sub === 'tracking-link/reissue' && method === 'POST') return reissueTrackingLink(ctx, id);
  }
  if (path === '/api/console/benefits' && method === 'POST') {
    return createBenefitsEntry(ctx);
  }

  // Console HTML.
  if (path === '/console/sign-in' && method === 'GET') {
    return renderConsolePage(ctx, 'sign-in');
  }
  if (path === '/console' || path === '/console/') {
    if (!ctx.session) {
      const { sendHtml } = await import('../http/plumbing.js');
      sendHtml(ctx.res, 303, '', { Location: '/console/sign-in' });
      ctx.res.end();
      return;
    }
    return renderConsolePage(ctx, 'home');
  }
  if (path.startsWith('/console/')) {
    if (!ctx.session) {
      const { sendHtml } = await import('../http/plumbing.js');
      sendHtml(ctx.res, 303, '', { Location: '/console/sign-in' });
      ctx.res.end();
      return;
    }
    return renderConsolePage(ctx, path.slice('/console/'.length));
  }

  throw errors.notFoundConsole();
}

function grantStatus(g: { revoked_at: Date | null; expires_at: Date }): 'active' | 'expired' | 'revoked' {
  if (g.revoked_at) return 'revoked';
  if (new Date(g.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

async function signInRoute(ctx: RequestCtx): Promise<void> {
  const body = await readBody(ctx.req, jsonMaxBytes());
  if (!body.ok) {
    if (body.tooLarge) throw errors.payloadTooLarge();
    throw errors.unsupportedMediaType(false);
  }
  const parsed = parseJsonBody(body.body.toString('utf8'));
  if (!parsed.ok) throw errors.unsupportedMediaType(false);
  const payload = (parsed.value ?? {}) as Record<string, unknown>;
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!email || !password) {
    throw errors.invalidCredentials();
  }
  const result = await withTransaction(async (client) => {
    return signIn(client, email, password, verifyPassword);
  });
  if (result === 'invalid' || result === 'locked') {
    throw errors.invalidCredentials();
  }
  const sessionId = randomToken(32);
  await withTransaction(async (client) => {
    await createSession(client, result.staff.email, sessionId);
  });
  const cookie = `open_record_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.sessionTtlSeconds}`;
  return sendJson(ctx.res, 200, {
    staff: { email: result.staff.email, name: result.staff.name, roles: result.grants },
  }, { ...ctx.rateHeaders, 'Set-Cookie': cookie });
}

async function signOutRoute(ctx: RequestCtx): Promise<void> {
  const session = requireSession(ctx);
  const sessionId = ctx.cookies['open_record_session'];
  if (sessionId) {
    await withTransaction(async (client) => {
      await deleteSession(client, sessionId);
    });
  }
  sendJson(ctx.res, 204, null, {
    ...ctx.rateHeaders,
    'Set-Cookie': 'open_record_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
  });
  ctx.res.end();
}

async function createGrant(ctx: RequestCtx): Promise<void> {
  const session = requireRole(ctx, 'administrator');
  const payload = await readJson(ctx);
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const fields = await validateGrant(client, payload);
    if (fields) {
      throw errors.validation(fields);
    }
    const email = String(payload.staff_email).trim().toLowerCase();
    const role = String(payload.role) as StaffRole;
    const expiresAt = String(payload.expires_at);
    const existing = await client.query(
      `SELECT id FROM grants WHERE staff_email = $1 AND role = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [email, role],
    );
    if (existing.rows.length > 0) {
      throw new ApiError(409, 'grant_exists', 'That person already holds this role.');
    }
    const rows = await client.query(
      `INSERT INTO grants (staff_email, role, granted_by, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [email, role, session.email, expiresAt],
    );
    const grant = rows.rows[0];
    await writeAudit(client, {
      actor: session.email,
      action: 'grant.create',
      targetType: 'grant',
      targetId: grant.id,
      detail: { grantee: email, role, expires_at: expiresAt },
    });
    const body = { grant: grantView(grant) };
    await idem.finish(client, 201, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 201, result.body, ctx.rateHeaders);
}

async function validateGrant(client: import('../platform/db.js').DbClient, payload: Record<string, unknown>): Promise<Record<string, string> | null> {
  const fields: Record<string, string> = {};
  const email = typeof payload.staff_email === 'string' ? payload.staff_email.trim().toLowerCase() : '';
  const staff = email ? await staffByEmail(client, email) : null;
  if (!staff) fields.staff_email = 'No staff account has that email.';
  const role = typeof payload.role === 'string' ? payload.role : '';
  if (!['editor', 'approver', 'recruiter', 'administrator'].includes(role)) {
    fields.role = 'Choose editor, approver, recruiter or administrator.';
  }
  const expiresRaw = typeof payload.expires_at === 'string' ? payload.expires_at : '';
  const expires = new Date(expiresRaw);
  if (!expiresRaw || Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
    fields.expires_at = 'Choose an expiry in the future.';
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

function grantView(g: Record<string, unknown>): Record<string, unknown> {
  return {
    id: g.id,
    staff_email: g.staff_email,
    role: g.role,
    granted_by: g.granted_by,
    granted_at: new Date(g.granted_at as string).toISOString(),
    expires_at: new Date(g.expires_at as string).toISOString(),
    revoked_at: g.revoked_at ? new Date(g.revoked_at as string).toISOString() : null,
    revoked_by: g.revoked_by ?? null,
    status: grantStatus({
      revoked_at: g.revoked_at ? new Date(g.revoked_at as string) : null,
      expires_at: new Date(g.expires_at as string),
    }),
    version: g.version,
  };
}

async function revokeGrant(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireRole(ctx, 'administrator');
  const payload = await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const rows = await client.query(`SELECT * FROM grants WHERE id = $1 FOR UPDATE`, [id]);
    const grant = rows.rows[0];
    if (!grant) throw errors.notFoundConsole();
    if (grant.revoked_at || new Date(grant.expires_at).getTime() <= Date.now()) {
      throw new ApiError(409, 'grant_inactive', 'This grant has already ended.');
    }
    if (grant.version !== version) throw errors.staleVersion();
    if (grant.role === 'administrator') {
      const active = await client.query(
        `SELECT count(*)::int AS n FROM grants
         WHERE role = 'administrator' AND revoked_at IS NULL AND expires_at > now()`,
      );
      if ((active.rows[0]?.n ?? 0) <= 1) {
        throw new ApiError(409, 'last_administrator', 'You cannot revoke the last active administrator grant.');
      }
    }
    const updated = await client.query(
      `UPDATE grants SET revoked_at = now(), revoked_by = $1, version = version + 1
       WHERE id = $2 AND version = $3 RETURNING *`,
      [session.email, id, version],
    );
    if ((updated.rowCount ?? 0) === 0) throw errors.staleVersion();
    await writeAudit(client, {
      actor: session.email,
      action: 'grant.revoke',
      targetType: 'grant',
      targetId: id,
      detail: { grantee: grant.staff_email, role: grant.role },
    });
    // Void any not-yet-cleared sign-offs by this grantee.
    const signoffs = await client.query<{ content_id: string; safety_by: string | null; legal_by: string | null }>(
      `SELECT content_id, safety_by, legal_by FROM release_records
       WHERE status <> 'cleared' AND status <> 'open' AND (safety_by = $1 OR legal_by = $1)`,
      [grant.staff_email],
    );
    for (const row of signoffs.rows) {
      if (row.safety_by === grant.staff_email) {
        await voidSignoffsFor(client, row.content_id, session.email, 'signoff_lapsed', 'safety', grant.staff_email);
      } else if (row.legal_by === grant.staff_email) {
        await voidSignoffsFor(client, row.content_id, session.email, 'signoff_lapsed', 'legal', grant.staff_email);
      }
    }
    const body = { grant: grantView(updated.rows[0]) };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

function idempotencyKey(ctx: RequestCtx): string | null {
  const header = ctx.req.headers['idempotency-key'];
  if (typeof header !== 'string' || header === '') return null;
  return header;
}

// ---------------------------------------------------------------------------
// Content routes

async function createContent(ctx: RequestCtx): Promise<void> {
  const session = requireRole(ctx, 'editor');
  const payload = await readJson(ctx);
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const kind = payload.kind === 'model' || payload.kind === 'news' ? (payload.kind as ContentKind) : null;
    if (!kind) {
      throw errors.validation({ kind: 'Choose model or news.' });
    }
    const offending = readOnlyFieldsFor({ ...payload, kind: undefined }, kind, false);
    if (offending) {
      const fields: Record<string, string> = {};
      for (const k of Object.keys(offending)) fields[k] = offending[k];
      throw errors.readOnlyFields(fields);
    }
    const fields = validateContentFields(payload, kind, client).fields;
    const slug = trim(String(payload.slug ?? ''));
    if (Object.keys(fields).length === 0 && (await slugInUse(client, slug))) {
      fields.slug = 'That slug is already in use.';
    }
    if (Object.keys(fields).length > 0) {
      throw errors.validation(fields);
    }
    const content = await insertContent(client, {
      kind,
      slug,
      title: trim(String(payload.title)),
      summary: trim(String(payload.summary)),
      body: trim(String(payload.body)),
      subject: kind === 'news' ? (payload.subject as string | null) : null,
      tags: kind === 'news' ? (payload.tags as string[] | null) : null,
      claims: kind === 'model' ? (payload.claims as ContentRow['claims']) : null,
      linked_news_slug: kind === 'model' && payload.linked_news_slug ? String(payload.linked_news_slug) : null,
      author: session.email,
    });
    if (kind === 'model' && payload.linked_news_slug) {
      const exists = await client.query(`SELECT id FROM content_items WHERE slug = $1 AND kind = 'news'`, [String(payload.linked_news_slug)]);
      if (exists.rows.length === 0) {
        throw errors.validation({ linked_news_slug: 'No news post has that slug.' });
      }
    }
    const body = { content: { ...contentToView(content), comments: [] } };
    await idem.finish(client, 201, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 201, result.body, ctx.rateHeaders);
}

async function getContent(ctx: RequestCtx, id: string): Promise<void> {
  requireAnyRole(ctx, ['editor', 'approver']);
  const content = await getContentById(ctx.client, id);
  if (!content) throw errors.notFoundConsole();
  const comments = await loadComments(ctx.client, id);
  const release = content.kind === 'model' ? viewReleaseRecord(await getReleaseRecord(ctx.client, id)) : null;
  const view = contentToView(content);
  view.comments = comments;
  view.release_record = release;
  sendJson(ctx.res, 200, { content: view }, { ...ctx.rateHeaders, ETag: etagFor(content.version) });
}

async function patchContent(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  const payload = await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  if (!hasRole(session, 'editor')) throw errors.forbidden();
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.author_email !== session.email) throw errors.forbidden();
    if (content.status !== 'draft' && content.status !== 'returned') {
      throw new ApiError(409, 'not_editable', 'Only drafts and returned items can be edited.');
    }
    const offending = readOnlyFieldsFor(payload, content.kind, true);
    if (offending) throw errors.readOnlyFields(offending);
    if (content.kind === 'model' && payload.claims === undefined && payload.body === undefined) {
      // No claims touched; nothing to do beyond named fields.
    }
    const patch: Record<string, unknown> = { ...payload };
    delete patch.kind;
    if (content.kind === 'news') {
      delete patch.claims;
      delete patch.linked_news_slug;
    } else {
      delete patch.subject;
      delete patch.tags;
    }
    const fields = validateContentFields(
      { ...contentAsPayload(content), ...patch },
      content.kind,
      client,
    ).fields;
    const slug = patch.slug !== undefined ? trim(String(patch.slug)) : content.slug;
    if (Object.keys(fields).length === 0 && patch.slug !== undefined && (await slugInUse(client, slug, id))) {
      fields.slug = 'That slug is already in use.';
    }
    if (content.kind === 'model' && patch.linked_news_slug) {
      const exists = await client.query(`SELECT id FROM content_items WHERE slug = $1 AND kind = 'news'`, [String(patch.linked_news_slug)]);
      if (exists.rows.length === 0) fields.linked_news_slug = 'No news post has that slug.';
    }
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    await updateContentFields(client, id, patch, content, session.email);
    const updated = await getContentById(client, id);
    const comments = await loadComments(client, id);
    const body = { content: { ...contentToView(updated as ContentRow), comments } };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

function contentAsPayload(content: ContentRow): Record<string, unknown> {
  return {
    slug: content.slug,
    title: content.title,
    summary: content.summary,
    body: content.body,
    subject: content.subject,
    tags: content.tags,
    claims: content.claims,
    linked_news_slug: content.linked_news_slug,
  };
}

async function submitContent(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  if (!hasRole(session, 'editor')) throw errors.forbidden();
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, {});
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.author_email !== session.email) throw errors.forbidden();
    await transitionContent(client, id, content.status, 'in_review', version, session.email, 'content.submit', { slug: content.slug });
    if (content.kind === 'model') {
      await notifyApproversOfSignoff(client, content);
    }
    const updated = await getContentById(client, id);
    const comments = await loadComments(client, id);
    const body = { content: { ...contentToView(updated as ContentRow), comments } };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function notifyApproversOfSignoff(client: import('../platform/db.js').DbClient, content: ContentRow): Promise<void> {
  const approvers = await client.query<{ staff_email: string; name: string }>(
    `SELECT DISTINCT g.staff_email, s.name FROM grants g
     JOIN staff s ON s.email = g.staff_email
     WHERE g.role = 'approver' AND g.revoked_at IS NULL AND g.expires_at > now()`,
  );
  for (const approver of approvers.rows) {
    if (approver.staff_email === content.author_email) continue;
    await queueMail(client, {
      to: { name: approver.name, email: approver.staff_email },
      subject: `Release record awaiting sign-off: ${content.title}`,
      body: `The model route "${content.title}" has been submitted for review.\n\nYou can read it in the console at /console/content/${content.id}.`,
    });
  }
}

async function staffName(client: import('../platform/db.js').DbClient, email: string): Promise<string> {
  const rows = await client.query<{ name: string }>(`SELECT name FROM staff WHERE email = $1`, [email]);
  return rows.rows[0]?.name ?? email;
}

async function addComment(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireAnyRole(ctx, ['editor', 'approver']);
  const payload = await readJson(ctx);
  const body = typeof payload.body === 'string' ? trim(payload.body) : '';
  if (body.length === 0 || codePoints(body) > 4000) {
    throw errors.validation({ body: 'Enter a comment.' });
  }
  const content = await getContentById(ctx.client, id);
  if (!content) throw errors.notFoundConsole();
  if (content.status === 'scheduled') {
    throw new ApiError(409, 'comments_closed', 'Comments are closed once an item is scheduled.');
  }
  const rows = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO comments (content_id, author_email, body) VALUES ($1, $2, $3) RETURNING *`,
      [id, session.email, body],
    );
    await writeAudit(client, {
      actor: session.email,
      action: 'content.comment',
      targetType: 'content',
      targetId: id,
      detail: { slug: content.slug },
    });
    return inserted.rows[0];
  });
  sendJson(ctx.res, 201, {
    comment: {
      id: rows.id,
      author: rows.author_email,
      body: rows.body,
      created_at: new Date(rows.created_at).toISOString(),
    },
  }, ctx.rateHeaders);
}

async function approveContent(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  if (!hasRole(session, 'approver')) throw errors.forbidden();
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, {});
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.author_email === session.email) throw errors.authorCannotApprove();
    await transitionContent(client, id, content.status, 'approved', version, session.email, 'content.approve', { slug: content.slug, title: content.title });
    const updated = await getContentById(client, id);
    const comments = await loadComments(client, id);
    const body = { content: { ...contentToView(updated as ContentRow), comments } };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function returnContent(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  const payload = await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  if (!hasRole(session, 'approver')) throw errors.forbidden();
  const reason = typeof payload.reason === 'string' ? trim(payload.reason) : '';
  if (reason.length === 0 || codePoints(reason) > 2000) {
    throw errors.validation({ reason: 'Say what needs to change.' });
  }
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.author_email === session.email) throw errors.authorCannotApprove();
    await transitionContent(client, id, content.status, 'returned', version, session.email, 'content.return', { slug: content.slug, reason });
    const updated = await getContentById(client, id);
    const comments = await loadComments(client, id);
    const body = { content: { ...contentToView(updated as ContentRow), comments } };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function scheduleContent(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  const payload = await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  if (!hasRole(session, 'approver')) throw errors.forbidden();
  const value = typeof payload.release_at_local === 'string' ? payload.release_at_local : '';
  const parsed = parseLondonTime(value);
  if (!parsed.ok) {
    throw errors.validation({
      release_at_local:
        parsed.reason === 'nonexistent'
          ? 'That time does not exist in London because the clocks go forward.'
          : 'Use the form YYYY-MM-DDTHH:mm.',
    });
  }
  if (parsed.instant.getTime() <= Date.now()) {
    throw errors.validation({ release_at_local: 'Choose a time in the future.' });
  }
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.author_email === session.email) throw errors.authorCannotApprove();
    if (content.status !== 'approved') {
      throw errors.illegalTransition(content.status, 'scheduled');
    }
    if (content.kind === 'model') {
      const status = await recordStatus(client, id);
      if (status !== 'cleared') {
        throw new ApiError(409, 'release_record_not_cleared', "This model route's release record is not cleared.");
      }
      if (content.linked_news_slug) {
        const linked = await client.query<{ status: string; id: string }>(
          `SELECT status, id FROM content_items WHERE slug = $1 AND kind = 'news'`,
          [content.linked_news_slug],
        );
        if (linked.rows.length === 0 || linked.rows[0].status !== 'approved') {
          throw new ApiError(409, 'linked_post_not_ready', 'The linked announcement must be approved before scheduling.');
        }
      }
    }
    if (content.kind === 'news') {
      const linkedToModel = await client.query<{ id: string }>(
        `SELECT id FROM content_items WHERE linked_news_slug = $1 AND kind = 'model' AND status IN ('scheduled','published')`,
        [content.slug],
      );
      if (linkedToModel.rows.length > 0) {
        throw new ApiError(409, 'linked_to_model', 'This post releases with its model route.');
      }
    }
    const ids = [content.id];
    if (content.kind === 'model' && content.linked_news_slug) {
      const linked = await client.query<{ id: string }>(
        `SELECT id FROM content_items WHERE slug = $1 AND kind = 'news'`,
        [content.linked_news_slug],
      );
      if (linked.rows.length > 0) ids.push(linked.rows[0].id);
    }
    await scheduleForRelease(client, ids, parsed.instant, session.email);
    const updated = await getContentById(client, id);
    const comments = await loadComments(client, id);
    const body = {
      content: {
        ...contentToView(updated as ContentRow),
        comments,
        release_at_local: value,
        zone: 'Europe/London',
      },
    };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function scheduleForRelease(
  client: import('../platform/db.js').DbClient,
  ids: string[],
  instant: Date,
  actor: string,
): Promise<void> {
  for (const id of ids) {
    const content = await getContentById(client, id);
    if (!content) continue;
    const updated = await client.query(
      `UPDATE content_items SET status = 'scheduled', release_at = $1, version = version + 1, updated_at = now()
       WHERE id = $2 RETURNING version`,
      [instant.toISOString(), id],
    );
    if ((updated.rowCount ?? 0) === 0) throw errors.staleVersion();
    await client.query(
      `INSERT INTO embargo_releases (content_id, release_at) VALUES ($1, $2)
       ON CONFLICT (content_id) DO UPDATE SET release_at = $2, released = false`,
      [id, instant.toISOString()],
    );
    await writeAudit(client, {
      actor,
      action: 'content.schedule',
      targetType: 'content',
      targetId: id,
      detail: { slug: content.slug, release_at: instant.toISOString(), zone: 'Europe/London' },
    });
  }
}

async function releaseContent(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  if (!hasRole(session, 'approver')) throw errors.forbidden();
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, {});
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.author_email === session.email) throw errors.authorCannotApprove();
    if (content.kind === 'news') {
      const linkedToModel = await client.query<{ id: string }>(
        `SELECT id FROM content_items WHERE linked_news_slug = $1 AND kind = 'model' AND status = 'scheduled'`,
        [content.slug],
      );
      if (linkedToModel.rows.length > 0) {
        throw new ApiError(409, 'linked_to_model', 'This post releases with its model route.');
      }
    }
    if (content.status !== 'scheduled') {
      throw errors.illegalTransition(content.status, 'published');
    }
    const ids = [content.id];
    if (content.kind === 'model' && content.linked_news_slug) {
      const linked = await client.query<{ id: string }>(
        `SELECT id FROM content_items WHERE slug = $1 AND kind = 'news'`,
        [content.linked_news_slug],
      );
      if (linked.rows.length > 0) ids.push(linked.rows[0].id);
    }
    await publishNow(client, ids, session.email, 'content.release');
    const updated = await getContentById(client, id);
    const comments = await loadComments(client, id);
    const body = { content: { ...contentToView(updated as ContentRow), comments } };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function publishNow(
  client: import('../platform/db.js').DbClient,
  ids: string[],
  actor: string,
  action: 'content.release',
  at: Date = new Date(),
): Promise<void> {
  for (const id of ids) {
    const content = await getContentById(client, id);
    if (!content) continue;
    if (content.status !== 'scheduled') throw errors.illegalTransition(content.status, 'published');
    const readTime = computeReadTime(content);
    const updated = await client.query(
      `UPDATE content_items SET status = 'published', published_at = $1, read_time_minutes = $2,
         release_at = NULL, version = version + 1, updated_at = now()
       WHERE id = $3 RETURNING version`,
      [at.toISOString(), readTime, id],
    );
    if ((updated.rowCount ?? 0) === 0) throw errors.staleVersion();
    await client.query(
      `INSERT INTO publication_history (content_id, published_at) VALUES ($1, $2)
       ON CONFLICT (content_id) DO UPDATE SET published_at = $2, withdrawn_at = NULL`,
      [id, at.toISOString()],
    );
    await client.query(
      `UPDATE embargo_releases SET released = true WHERE content_id = $1`,
      [id],
    );
    await writeAudit(client, {
      actor,
      action,
      targetType: 'content',
      targetId: id,
      detail: { slug: content.slug, published_at: at.toISOString() },
    });
    await indexContentItem(client, id);
  }
}

function computeReadTime(content: ContentRow): number {
  return readTimeMinutes(content.body, content.claims);
}

async function withdrawContent(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  if (!hasRole(session, 'approver')) throw errors.forbidden();
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, {});
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.kind === 'news') {
      const linkedToModel = await client.query<{ id: string }>(
        `SELECT id FROM content_items WHERE linked_news_slug = $1 AND kind = 'model' AND status = 'scheduled'`,
        [content.slug],
      );
      if (linkedToModel.rows.length > 0) {
        throw new ApiError(409, 'linked_to_model', 'This post releases with its model route.');
      }
    }
    if (content.status !== 'published' && content.status !== 'scheduled') {
      throw errors.illegalTransition(content.status, 'withdrawn');
    }
    const ids = [content.id];
    if (content.kind === 'model' && content.linked_news_slug) {
      const linked = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM content_items WHERE slug = $1 AND kind = 'news'`,
        [content.linked_news_slug],
      );
      if (linked.rows.length > 0 && linked.rows[0].status !== 'withdrawn') {
        ids.push(linked.rows[0].id);
      }
    }
    for (const cid of ids) {
      const item = await getContentById(client, cid);
      if (!item) continue;
      await transitionContent(client, cid, item.status, 'withdrawn', version, session.email, 'content.withdraw', { slug: item.slug });
    }
    await refreshSearchIndex(client);
    const updated = await getContentById(client, id);
    const comments = await loadComments(client, id);
    const body = { content: { ...contentToView(updated as ContentRow), comments } };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

// ---------------------------------------------------------------------------
// Requisitions, applications, benefits

type RequisitionRow = {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'open' | 'closed';
  discipline: string;
  office: string;
  description: string;
  opened_at: Date | null;
  closed_at: Date | null;
  close_reason: string | null;
  version: number;
};

async function listRequisitions(ctx: RequestCtx): Promise<void> {
  const session = requireRole(ctx, 'recruiter');
  const rows = await ctx.client.query<RequisitionRow>(
    `SELECT * FROM requisitions r
     WHERE EXISTS (
       SELECT 1 FROM requisition_recruiters rr WHERE rr.requisition_id = r.id AND rr.email = $1
     )
     ORDER BY created_at DESC`,
    [session.email],
  );
  const items: unknown[] = [];
  for (const r of rows.rows) {
    const counts = await stageCounts(ctx.client, r.id);
    items.push({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      discipline: r.discipline,
      office: r.office,
      recruiters: await recruitersFor(ctx.client, r.id),
      version: r.version,
      counts,
    });
  }
  sendJson(ctx.res, 200, { requisitions: items }, ctx.rateHeaders);
}

async function stageCounts(client: import('../platform/db.js').DbClient, requisitionId: string): Promise<Record<string, number>> {
  const rows = await client.query<{ stage: string; n: number }>(
    `SELECT stage, count(*)::int AS n FROM applications WHERE requisition_id = $1 GROUP BY stage`,
    [requisitionId],
  );
  const counts: Record<string, number> = {};
  for (const stage of ['submitted', 'screening', 'interview', 'final_review', 'offer', 'declined', 'withdrawn']) {
    counts[stage] = 0;
  }
  for (const row of rows.rows) counts[row.stage] = row.n;
  return counts;
}

async function recruitersFor(client: import('../platform/db.js').DbClient, requisitionId: string): Promise<string[]> {
  const rows = await client.query<{ email: string }>(
    `SELECT email FROM requisition_recruiters WHERE requisition_id = $1 ORDER BY email`,
    [requisitionId],
  );
  return rows.rows.map((r) => r.email);
}

async function assignedRequisition(
  ctx: RequestCtx,
  id: string,
): Promise<RequisitionRow> {
  const session = requireRole(ctx, 'recruiter');
  const rows = await ctx.client.query<RequisitionRow>(`SELECT * FROM requisitions WHERE id = $1`, [id]);
  const row = rows.rows[0];
  if (!row) throw errors.notFoundConsole();
  const assigned = await ctx.client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM requisition_recruiters WHERE requisition_id = $1 AND email = $2`,
    [id, session.email],
  );
  if ((assigned.rows[0]?.n ?? 0) === 0) throw errors.notFoundConsole();
  return row;
}

async function getRequisition(ctx: RequestCtx, id: string): Promise<void> {
  const row = await assignedRequisition(ctx, id);
  sendJson(ctx.res, 200, {
    requisition: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      discipline: row.discipline,
      office: row.office,
      description: row.description,
      recruiters: await recruitersFor(ctx.client, row.id),
      version: row.version,
      counts: await stageCounts(ctx.client, row.id),
    },
  }, { ...ctx.rateHeaders, ETag: etagFor(row.version) });
}

async function createRequisition(ctx: RequestCtx): Promise<void> {
  const session = requireRole(ctx, 'recruiter');
  const payload = await readJson(ctx);
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const fields: Record<string, string> = {};
    const slug = typeof payload.slug === 'string' ? trim(payload.slug) : '';
    const title = typeof payload.title === 'string' ? trim(payload.title) : '';
    const description = typeof payload.description === 'string' ? trim(payload.description) : '';
    const discipline = typeof payload.discipline === 'string' ? trim(payload.discipline) : '';
    const office = typeof payload.office === 'string' ? trim(payload.office) : '';
    const recruiters = Array.isArray(payload.recruiters) ? payload.recruiters : [];
    if (!slug || !isValidSlug(slug)) fields.slug = 'Use lowercase letters, numbers and single hyphens, up to 80 characters.';
    if (!title || codePoints(title) > 120) fields.title = 'Enter a title of at most 120 characters.';
    if (!description || codePoints(description) > 8000) fields.description = 'Enter a description of at most 8,000 characters.';
    if (!['research', 'engineering', 'policy', 'operations'].includes(discipline)) {
      fields.discipline = 'Choose a listed discipline.';
    }
    const officeRow = office ? await client.query<{ label: string }>(`SELECT label FROM offices WHERE slug = $1`, [office]) : null;
    if (!officeRow || officeRow.rows.length === 0) fields.office = 'Choose a listed office.';
    const recruiterEmails: string[] = [];
    for (const entry of recruiters) {
      const email = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
      if (!email) continue;
      const recruiter = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM grants WHERE staff_email = $1 AND role = 'recruiter' AND revoked_at IS NULL AND expires_at > now()`,
        [email],
      );
      if ((recruiter.rows[0]?.n ?? 0) === 0) {
        fields.recruiters = 'Each recruiter must hold the recruiter role.';
        break;
      }
      recruiterEmails.push(email);
    }
    if (!recruiterEmails.includes(session.email)) recruiterEmails.push(session.email);
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const slugTaken = await client.query(`SELECT id FROM requisitions WHERE slug = $1`, [slug]);
    if (slugTaken.rows.length > 0) fields.slug = 'That slug is already in use.';
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const rows = await client.query(
      `INSERT INTO requisitions (slug, title, status, discipline, office, description, version)
       VALUES ($1, $2, 'draft', $3, $4, $5, 1) RETURNING *`,
      [slug, title, discipline, office, description],
    );
    const req = rows.rows[0] as RequisitionRow;
    for (const email of recruiterEmails) {
      await client.query(
        `INSERT INTO requisition_recruiters (requisition_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.id, email],
      );
    }
    await writeAudit(client, {
      actor: session.email,
      action: 'requisition.create',
      targetType: 'requisition',
      targetId: req.id,
      detail: { slug, title, discipline, office },
    });
    const body = { requisition: { ...req, recruiters: recruiterEmails, counts: await stageCounts(client, req.id) } };
    await idem.finish(client, 201, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 201, result.body, ctx.rateHeaders);
}

async function openRequisition(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, {});
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const req = await client.query<RequisitionRow>(`SELECT * FROM requisitions WHERE id = $1 FOR UPDATE`, [id]);
    const row = req.rows[0];
    if (!row) throw errors.notFoundConsole();
    const assigned = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM requisition_recruiters WHERE requisition_id = $1 AND email = $2`,
      [id, session.email],
    );
    if ((assigned.rows[0]?.n ?? 0) === 0) throw errors.notFoundConsole();
    if (!hasRole({ email: session.email, name: session.name, grants: session.grants }, 'recruiter')) {
      throw errors.forbidden();
    }
    if (!requisitionCanMove(row.status, 'open')) {
      throw errors.illegalTransition(row.status, 'open');
    }
    const now = new Date();
    const updated = await client.query(
      `UPDATE requisitions SET status = 'open', opened_at = $1, version = version + 1
       WHERE id = $2 AND version = $3 RETURNING *`,
      [now.toISOString(), id, version],
    );
    if ((updated.rowCount ?? 0) === 0) throw errors.staleVersion();
    await writeAudit(client, {
      actor: session.email,
      action: 'requisition.open',
      targetType: 'requisition',
      targetId: id,
      detail: { slug: row.slug, opened_at: now.toISOString() },
    });
    await refreshSearchIndex(client);
    const body = { requisition: { ...updated.rows[0], counts: await stageCounts(client, id) } };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function closeRequisition(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  const payload = await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  const reason = typeof payload.reason === 'string' ? trim(payload.reason) : '';
  if (!reason || codePoints(reason) > 2000) {
    throw errors.validation({ reason: 'Say why this requisition is closing.' });
  }
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const req = await client.query<RequisitionRow>(`SELECT * FROM requisitions WHERE id = $1 FOR UPDATE`, [id]);
    const row = req.rows[0];
    if (!row) throw errors.notFoundConsole();
    const assigned = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM requisition_recruiters WHERE requisition_id = $1 AND email = $2`,
      [id, session.email],
    );
    if ((assigned.rows[0]?.n ?? 0) === 0) throw errors.notFoundConsole();
    if (!hasRole({ email: session.email, name: session.name, grants: session.grants }, 'recruiter')) {
      throw errors.forbidden();
    }
    if (!requisitionCanMove(row.status, 'closed')) {
      throw errors.illegalTransition(row.status, 'closed');
    }
    const now = new Date();
    const deadline = new Date(now.getTime() + config.applicationRetentionSeconds * 1000);
    const updated = await client.query(
      `UPDATE requisitions SET status = 'closed', closed_at = $1, close_reason = $2,
         retention_deadline = $3, version = version + 1
       WHERE id = $4 AND version = $5 RETURNING *`,
      [now.toISOString(), reason, deadline.toISOString(), id, version],
    );
    if ((updated.rowCount ?? 0) === 0) throw errors.staleVersion();
    await writeAudit(client, {
      actor: session.email,
      action: 'requisition.close',
      targetType: 'requisition',
      targetId: id,
      detail: { slug: row.slug, reason },
    });
    // Decline every active application, one audit entry each.
    const active = await client.query<{ id: string; stage: string; version: number }>(
      `SELECT id, stage, version FROM applications WHERE requisition_id = $1 AND stage = ANY($2) FOR UPDATE`,
      [id, ACTIVE_STAGES],
    );
    for (const app of active.rows) {
      await client.query(
        `UPDATE applications SET stage = 'declined', stage_changed_at = now(), version = version + 1 WHERE id = $1`,
        [app.id],
      );
      await client.query(
        `INSERT INTO stage_decisions (application_id, from_stage, to_stage, rationale, by_email)
         VALUES ($1, $2, 'declined', $3, $4)`,
        [app.id, app.stage, `Requisition closed: ${reason}`, session.email],
      );
      await writeAudit(client, {
        actor: session.email,
        action: 'application.stage',
        targetType: 'application',
        targetId: app.id,
        detail: { to: 'declined', reason: 'requisition_closed' },
      });
      await queueStageNotice(client, app.id, 'declined');
    }
    await refreshSearchIndex(client);
    const body = { requisition: { ...updated.rows[0], counts: await stageCounts(client, id) } };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function queueStageNotice(
  client: import('../platform/db.js').DbClient,
  applicationId: string,
  stage: string,
): Promise<void> {
  const rows = await client.query<{ name: string; email: string; reference: string; title: string; token_digest: string }>(
    `SELECT a.name, a.email, a.reference, r.title, a.token_digest
     FROM applications a JOIN requisitions r ON r.id = a.requisition_id
     WHERE a.id = $1`,
    [applicationId],
  );
  const row = rows.rows[0];
  if (!row || !row.token_digest) return;
  await queueMail(client, {
    to: { name: row.name, email: row.email },
    subject: 'Update on your Aldermoor application',
    body: `Your application for "${row.title}" has moved to a new stage.\n\nYour application is now at: ${STAGE_LABELS[stage as keyof typeof STAGE_LABELS]}.\n\nYou can follow it with your tracking link.`,
  });
}

async function listApplications(ctx: RequestCtx, id: string): Promise<void> {
  await assignedRequisition(ctx, id);
  const rows = await ctx.client.query(
    `SELECT id, reference, name, email, stage, submitted_at, version
     FROM applications WHERE requisition_id = $1 ORDER BY submitted_at DESC`,
    [id],
  );
  sendJson(ctx.res, 200, {
    applications: rows.rows.map((r) => ({
      ...r,
      submitted_at: new Date(r.submitted_at).toISOString(),
    })),
  }, ctx.rateHeaders);
}

type ApplicationRow = {
  id: string;
  requisition_id: string;
  reference: string;
  name: string;
  email: string;
  stage: string;
  stage_changed_at: Date;
  resume_key: string | null;
  token_digest: string | null;
  submitted_at: Date;
  version: number;
};

async function getApplication(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireRole(ctx, 'recruiter');
  const rows = await ctx.client.query<ApplicationRow>(
    `SELECT * FROM applications WHERE id = $1`,
    [id],
  );
  const app = rows.rows[0];
  if (!app) throw errors.notFoundConsole();
  const assigned = await ctx.client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM requisition_recruiters WHERE requisition_id = $1 AND email = $2`,
    [app.requisition_id, session.email],
  );
  if ((assigned.rows[0]?.n ?? 0) === 0) throw errors.notFoundConsole();
  const decisions = await ctx.client.query(
    `SELECT from_stage, to_stage, rationale, by_email, at FROM stage_decisions
     WHERE application_id = $1 ORDER BY at ASC`,
    [id],
  );
  const notes = await ctx.client.query(
    `SELECT id, body, by_email, at FROM application_notes WHERE application_id = $1 ORDER BY at ASC`,
    [id],
  );
  sendJson(ctx.res, 200, {
    application: {
      id: app.id,
      reference: app.reference,
      name: app.name,
      email: app.email,
      stage: app.stage,
      version: app.version,
      submitted_at: new Date(app.submitted_at).toISOString(),
      decisions: decisions.rows.map((d) => ({
        from: d.from_stage,
        to: d.to_stage,
        rationale: d.rationale,
        by: d.by_email,
        at: new Date(d.at).toISOString(),
      })),
      notes: notes.rows.map((n) => ({
        id: n.id,
        body: n.body,
        by: n.by_email,
        at: new Date(n.at).toISOString(),
      })),
    },
  }, { ...ctx.rateHeaders, ETag: etagFor(app.version) });
}

async function moveApplicationStage(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  const payload = await readJson(ctx);
  const version = ifMatchVersion(ctx.req);
  if (version === null) throw errors.versionRequired();
  const to = typeof payload.to === 'string' ? payload.to : '';
  const rationale = typeof payload.rationale === 'string' ? trim(payload.rationale) : '';
  if (!rationale || codePoints(rationale) > 2000) {
    throw errors.validation({ rationale: 'Record the reason for this decision.' });
  }
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const rows = await client.query<ApplicationRow>(
      `SELECT * FROM applications WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const app = rows.rows[0];
    if (!app) throw errors.notFoundConsole();
    const assigned = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM requisition_recruiters WHERE requisition_id = $1 AND email = $2`,
      [app.requisition_id, session.email],
    );
    if ((assigned.rows[0]?.n ?? 0) === 0) throw errors.notFoundConsole();
    if (!hasRole({ email: session.email, name: session.name, grants: session.grants }, 'recruiter')) {
      throw errors.forbidden();
    }
    if (app.version !== version) throw errors.staleVersion();
    if (!applicationCanMove(app.stage as ApplicationStage, to as ApplicationStage)) {
      throw errors.illegalTransition(app.stage, to);
    }
    const updated = await client.query(
      `UPDATE applications SET stage = $1, stage_changed_at = now(), version = version + 1
       WHERE id = $2 AND version = $3 RETURNING *`,
      [to, id, version],
    );
    if ((updated.rowCount ?? 0) === 0) throw errors.staleVersion();
    await client.query(
      `INSERT INTO stage_decisions (application_id, from_stage, to_stage, rationale, by_email)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, app.stage, to, rationale, session.email],
    );
    await writeAudit(client, {
      actor: session.email,
      action: 'application.stage',
      targetType: 'application',
      targetId: id,
      detail: { reference: app.reference, from: app.stage, to },
    });
    await queueStageNotice(client, id, to);
    const decisions = await client.query(
      `SELECT from_stage, to_stage, rationale, by_email, at FROM stage_decisions WHERE application_id = $1 ORDER BY at`,
      [id],
    );
    const body = {
      application: {
        id,
        reference: app.reference,
        name: app.name,
        email: app.email,
        stage: to,
        version: version + 1,
        submitted_at: new Date(app.submitted_at).toISOString(),
        decisions: decisions.rows.map((d) => ({
          from: d.from_stage,
          to: d.to_stage,
          rationale: d.rationale,
          by: d.by_email,
          at: new Date(d.at).toISOString(),
        })),
        notes: [],
      },
    };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function addApplicationNote(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireRole(ctx, 'recruiter');
  const payload = await readJson(ctx);
  const body = typeof payload.body === 'string' ? trim(payload.body) : '';
  if (!body || codePoints(body) > 4000) {
    throw errors.validation({ body: 'Enter a note.' });
  }
  const rows = await ctx.client.query<ApplicationRow>(`SELECT * FROM applications WHERE id = $1`, [id]);
  const app = rows.rows[0];
  if (!app) throw errors.notFoundConsole();
  const assigned = await ctx.client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM requisition_recruiters WHERE requisition_id = $1 AND email = $2`,
    [app.requisition_id, session.email],
  );
  if ((assigned.rows[0]?.n ?? 0) === 0) throw errors.notFoundConsole();
  const inserted = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO application_notes (application_id, body, by_email) VALUES ($1, $2, $3) RETURNING *`,
      [id, body, session.email],
    );
    await writeAudit(client, {
      actor: session.email,
      action: 'application.note',
      targetType: 'application',
      targetId: id,
      detail: { reference: app.reference },
    });
    return res.rows[0];
  });
  sendJson(ctx.res, 201, {
    note: {
      id: inserted.id,
      body: inserted.body,
      by: inserted.by_email,
      at: new Date(inserted.at).toISOString(),
    },
  }, ctx.rateHeaders);
}

async function downloadResume(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireRole(ctx, 'recruiter');
  const rows = await ctx.client.query<ApplicationRow>(`SELECT * FROM applications WHERE id = $1`, [id]);
  const app = rows.rows[0];
  if (!app) throw errors.notFoundConsole();
  const assigned = await ctx.client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM requisition_recruiters WHERE requisition_id = $1 AND email = $2`,
    [app.requisition_id, session.email],
  );
  if ((assigned.rows[0]?.n ?? 0) === 0) throw errors.notFoundConsole();
  if (!app.resume_key) throw errors.notFoundConsole();
  const { getObject } = await import('../platform/storage.js');
  const result = await getObject(app.resume_key);
  if (!result.ok) {
    if (result.notFound) throw errors.notFoundConsole();
    throw new ApiError(503, 'storage_unavailable', 'Résumés are unavailable right now.');
  }
  ctx.res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': result.body.length,
    'Content-Disposition': `attachment; filename="resume-${app.reference}.pdf"`,
    'X-Content-Type-Options': 'nosniff',
    ...ctx.rateHeaders,
  });
  ctx.res.end(result.body);
}

async function reissueTrackingLink(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireRole(ctx, 'recruiter');
  await readJson(ctx);
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, {});
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const rows = await client.query<ApplicationRow & { req_status: string; req_title: string; retention_deadline: Date | null }>(
      `SELECT a.*, r.status AS req_status, r.title AS req_title, r.retention_deadline
       FROM applications a JOIN requisitions r ON r.id = a.requisition_id WHERE a.id = $1 FOR UPDATE OF a`,
      [id],
    );
    const app = rows.rows[0];
    if (!app) throw errors.notFoundConsole();
    const assigned = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM requisition_recruiters WHERE requisition_id = $1 AND email = $2`,
      [app.requisition_id, session.email],
    );
    if ((assigned.rows[0]?.n ?? 0) === 0) throw errors.notFoundConsole();
    if (app.req_status === 'closed' && app.retention_deadline && new Date(app.retention_deadline).getTime() < Date.now()) {
      throw new ApiError(409, 'link_retired', "This application's retention period has ended.");
    }
    const token = randomToken(32);
    await client.query(
      `UPDATE applications SET token_digest = $1 WHERE id = $2`,
      [tokenDigest(token), id],
    );
    await writeAudit(client, {
      actor: session.email,
      action: 'tracking_link.reissue',
      targetType: 'application',
      targetId: id,
      detail: { reference: app.reference },
    });
    await queueMail(client, {
      to: { name: app.name, email: app.email },
      subject: `Your new tracking link: ${app.req_title}`,
      body: `A new tracking link has been issued for your application to "${app.req_title}".\n\nUse this link from now on:\n${config.publicBaseUrl}/track/${token}\n\nYour previous link no longer works.`,
    });
    const body = { reissued_at: new Date().toISOString() };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function createBenefitsEntry(ctx: RequestCtx): Promise<void> {
  const session = requireRole(ctx, 'recruiter');
  const payload = await readJson(ctx);
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const fields: Record<string, string> = {};
    const region = typeof payload.region === 'string' ? trim(payload.region) : '';
    const effectiveFrom = typeof payload.effective_from === 'string' ? trim(payload.effective_from) : '';
    const summary = typeof payload.summary === 'string' ? trim(payload.summary) : '';
    const regionRow = region ? await client.query<{ label: string }>(`SELECT label FROM regions WHERE slug = $1`, [region]) : null;
    if (!regionRow || regionRow.rows.length === 0) fields.region = 'Choose a listed region.';
    if (!isValidDate(effectiveFrom)) fields.effective_from = 'Use a real date in the form YYYY-MM-DD.';
    if (!summary || codePoints(summary) > 500) fields.summary = 'Enter a summary of at most 500 characters.';
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const existing = await client.query(
      `SELECT id FROM benefits_entries WHERE region = $1 AND effective_from = $2`,
      [region, effectiveFrom],
    );
    if (existing.rows.length > 0) {
      throw new ApiError(409, 'entry_exists', 'That region already has an entry from this date.');
    }
    const rows = await client.query(
      `INSERT INTO benefits_entries (region, effective_from, summary, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [region, effectiveFrom, summary, session.email],
    );
    const entry = rows.rows[0];
    await writeAudit(client, {
      actor: session.email,
      action: 'benefits.create',
      targetType: 'benefits_entry',
      targetId: entry.id,
      detail: { region, effective_from: effectiveFrom },
    });
    const body = { entry };
    await idem.finish(client, 201, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 201, result.body, ctx.rateHeaders);
}

async function getReleaseRecordRoute(ctx: RequestCtx, id: string): Promise<void> {
  requireAnyRole(ctx, ['editor', 'approver']);
  const content = await getContentById(ctx.client, id);
  if (!content) throw errors.notFoundConsole();
  if (content.kind !== 'model') throw errors.notFoundConsole();
  const record = await getReleaseRecord(ctx.client, id);
  sendJson(ctx.res, 200, { record: viewReleaseRecord(record) }, ctx.rateHeaders);
}

async function recordSignoffRoute(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  const payload = await readJson(ctx);
  if (!hasRole(session, 'approver')) throw errors.forbidden();
  const kind = payload.kind === 'safety' || payload.kind === 'legal' ? payload.kind : null;
  const note = typeof payload.note === 'string' ? trim(payload.note) : '';
  if (!kind || codePoints(note) > 2000) {
    throw errors.validation({ kind: 'Choose safety or legal.' });
  }
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.kind !== 'model') throw errors.notFoundConsole();
    if (content.author_email === session.email) throw errors.authorCannotApprove();
    if (content.status !== 'in_review' && content.status !== 'approved') {
      throw new ApiError(409, 'not_in_review', 'Sign-offs are recorded while a route is in review or approved.');
    }
    // Sign-off requires an active approver grant at this moment.
    const active = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM grants
       WHERE staff_email = $1 AND role = 'approver' AND revoked_at IS NULL AND expires_at > now()`,
      [session.email],
    );
    if ((active.rows[0]?.n ?? 0) === 0) throw errors.forbidden();
    const view = await recordSignoff(client, content, session.email, kind, note);
    const body = { record: view };
    await idem.finish(client, 201, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 201, result.body, ctx.rateHeaders);
}

async function validateClaimsRoute(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireAnyRole(ctx, ['editor', 'approver']);
  await readJson(ctx);
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, {});
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.kind !== 'model') throw errors.notFoundConsole();
    const record = await getReleaseRecord(client, id);
    if (!record) throw errors.notFoundConsole();
    if (record.status !== 'signed' && record.status !== 'claims_validated') {
      throw new ApiError(409, 'signoffs_incomplete', 'Record both sign-offs before validating claims.');
    }
    const lapse = await checkSignoffLapse(client, id);
    if (lapse.lapsed) {
      throw new ApiError(409, 'signoff_lapsed', 'A sign-off holder no longer holds the approver role. Record that sign-off again.');
    }
    const outcome = await runClaimValidation(client, content);
    if (!outcome.valid) {
      const fields: Record<string, string> = {};
      for (const failure of (outcome.view as { results: Array<{ claim: string; ok: boolean; reason: string }> }).results) {
        if (!failure.ok) fields[failure.claim] = failure.reason;
      }
      for (const issue of (outcome.view as { bodyIssues: string[] }).bodyIssues) {
        const claimId = /claim ([a-z0-9]+)/.exec(issue)?.[1] ?? 'body';
        fields[claimId] = issue;
      }
      throw new ApiError(422, 'claims_invalid', 'Some claims do not match the recorded rows.', fields);
    }
    await client.query(
      `UPDATE release_records SET claims_validated_at = now(), last_validation = $2::jsonb, status = 'claims_validated'
       WHERE content_id = $1`,
      [id, JSON.stringify((outcome.view as { results: unknown }).results)],
    );
    await writeAudit(client, {
      actor: session.email,
      action: 'claims.validate',
      targetType: 'release_record',
      targetId: id,
      detail: { slug: content.slug, valid: true },
    });
    const updated = await getReleaseRecord(client, id);
    const body = { record: viewReleaseRecord(updated) };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

async function clearReleaseRoute(ctx: RequestCtx, id: string): Promise<void> {
  const session = requireSession(ctx);
  await readJson(ctx);
  if (!hasRole(session, 'approver')) throw errors.forbidden();
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, {});
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const content = await getContentById(client, id);
    if (!content) throw errors.notFoundConsole();
    if (content.kind !== 'model') throw errors.notFoundConsole();
    if (content.author_email === session.email) throw errors.authorCannotApprove();
    const record = await getReleaseRecord(client, id);
    if (!record) throw errors.notFoundConsole();
    if (record.status !== 'claims_validated') {
      throw new ApiError(409, 'claims_not_validated', 'Validate the claims before clearing this record.');
    }
    const lapse = await checkSignoffLapse(client, id);
    if (lapse.lapsed) {
      throw new ApiError(409, 'signoff_lapsed', 'A sign-off holder no longer holds the approver role. Record that sign-off again.');
    }
    await client.query(
      `UPDATE release_records SET status = 'cleared', cleared_by = $1, cleared_at = now() WHERE content_id = $2`,
      [session.email, id],
    );
    await writeAudit(client, {
      actor: session.email,
      action: 'release_record.clear',
      targetType: 'release_record',
      targetId: id,
      detail: { slug: content.slug, title: content.title },
    });
    const updated = await getReleaseRecord(client, id);
    const body = { record: viewReleaseRecord(updated) };
    await idem.finish(client, 200, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 200, result.body, ctx.rateHeaders);
}

// ---------------------------------------------------------------------------
// Benchmark rows

async function createBenchmarkRow(ctx: RequestCtx): Promise<void> {
  const session = requireAnyRole(ctx, ['editor', 'approver']);
  const payload = await readJson(ctx);
  const scope = `staff:${session.email}`;
  const idem = new IdempotencyScope(scope);
  const key = idempotencyKey(ctx);
  const fingerprint = jsonFingerprint(ctx.method, ctx.path, payload);
  const result = await withTransaction(async (client) => {
    const r = await idem.begin(client, key, fingerprint);
    if (r.replay) return { replay: r.replay, body: null as unknown };
    const fields: Record<string, string> = {};
    const subject = typeof payload.subject === 'string' ? trim(payload.subject) : '';
    let subjectName = subject;
    let organisation = 'Aldermoor Labs';
    const model = await client.query<{ title: string }>(
      `SELECT title FROM content_items WHERE slug = $1 AND kind = 'model'`,
      [subject],
    );
    if (model.rows.length > 0) {
      subjectName = model.rows[0].title;
    } else {
      const comparator = await client.query<{ name: string; organisation: string }>(
        `SELECT name, organisation FROM comparators WHERE slug = $1`,
        [subject],
      );
      if (comparator.rows.length > 0) {
        subjectName = comparator.rows[0].name;
        organisation = comparator.rows[0].organisation;
      } else {
        fields.subject = 'Choose a model route or a recorded comparator.';
      }
    }
    const benchmark = typeof payload.benchmark === 'string' ? trim(payload.benchmark) : '';
    const evalDate = typeof payload.eval_date === 'string' ? trim(payload.eval_date) : '';
    const score = typeof payload.score === 'string' ? trim(payload.score) : '';
    const sourceNote = typeof payload.source_note === 'string' ? trim(payload.source_note) : '';
    if (!benchmark) fields.benchmark = 'Enter a benchmark name.';
    if (!isValidDate(evalDate)) fields.eval_date = 'Use a real date in the form YYYY-MM-DD.';
    if (!isValidScore(score)) fields.score = 'Enter a score from 0 to 100 with at most two decimals.';
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const existing = await client.query(
      `SELECT id FROM benchmark_rows WHERE subject = $1 AND benchmark = $2 AND eval_date = $3`,
      [subject, benchmark, evalDate],
    );
    if (existing.rows.length > 0) {
      throw new ApiError(409, 'row_exists', 'A row for this model, benchmark and date is already recorded.');
    }
    const rows = await client.query(
      `INSERT INTO benchmark_rows (subject, subject_name, organisation, benchmark, eval_date, score, source_note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [subject, subjectName, organisation, benchmark, evalDate, score, sourceNote, session.email],
    );
    const row = rows.rows[0];
    await writeAudit(client, {
      actor: session.email,
      action: 'row.create',
      targetType: 'benchmark_row',
      targetId: row.id,
      detail: { subject, benchmark, eval_date: evalDate, score },
    });
    const body = { row: { id: row.id, ...row } };
    await idem.finish(client, 201, body);
    return { replay: null, body };
  });
  if (result.replay) {
    return sendJson(ctx.res, result.replay.status, result.replay.body, { ...ctx.rateHeaders, 'Idempotency-Replayed': 'true' });
  }
  return sendJson(ctx.res, 201, result.body, ctx.rateHeaders);
}
