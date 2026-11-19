import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import type { Db } from './db';
import type { Valkey, Gotenberg } from './services';
import type { RequestContext } from './httpTypes';
import { ApiError, errors, ERROR_COPY } from './httpTypes';
import {
  createAuthSession,
  destroyAuthSession,
  readAuthSession,
  roleIn,
  tokenFromCookie,
  withIdempotency,
  hashBody,
} from './auth';
import { seed, applySchema, verifyPassword, hashPassword } from './seed';
import { OutboxPublisher } from './outbox';
import { TickEngine } from './tickEngine';
import {
  buildSessionState,
  commitTick,
  recount,
  deriveOccupancy,
  findRoute,
  checkDeadlock,
  type SessionState,
  blockGraph,
} from './sessionEngine';
import { buildReferenceContent } from './referenceLayout';
import { canonicalHash, canonicalJson } from '../shared/canonical';
import type {
  Authority,
  Conflict,
  CrewPacket,
  LayoutContent,
  LayoutVersion,
  Role,
  SessionSnapshot,
  SessionStatus,
  StandardsProfile,
  Train,
} from '../shared/domain';
import { fastClockLabel } from '../shared/scaleUnits';
import { checkLayout, checkPieceRules, randomId, type PieceInput } from '../shared/geometry';
import { getLayout, getStandards, addHistory, commitLayoutEvent, layoutCounts, buildPieceRecord } from './layoutCore';
import { snapshotOf } from './snapshotHelper';

const MAX_BODY = 1000000;

export interface RouteContext {
  db: Db;
  valkey: Valkey;
  gotenberg: Gotenberg;
  instanceId: string;
  instances: { id: string; up: boolean; pid: number | null }[];
}

type Handler = (ctx: RouteContext, req: RequestContext) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> }>;

interface Route {
  method: string;
  pattern: string[]; // path segments; ':name' captures
  handler: Handler;
  /** True when the handler requires an Idempotency-Key (checked before invalid_fields). */
  keyed?: boolean;
}

function route(method: string, path: string, handler: Handler, keyed = false): Route {
  return { method, pattern: path.split('/').filter((s) => s !== ''), handler, keyed };
}

const routes: Route[] = [];
function routeTable(): Route[] {
  if (routes.length > 0) return routes;
  // A write that carries a key answers idempotency_key_required before invalid_fields.
  const add = (m: string, p: string, h: Handler, keyed = false) => routes.push(route(m, p, h, keyed));
  add('GET', '/api/health', getHealth);
  add('GET', '/api/status', getStatus);
  add('GET', '/api/ops/instances', getOpsInstances);
  add('POST', '/api/ops/instances/:id/stop', postOpsStop);
  add('POST', '/api/auth/sign-in', postSignIn);
  add('POST', '/api/auth/sign-out', postSignOut);
  add('GET', '/api/me', getMe);
  add('POST', '/api/me/walkthrough', postWalkthrough);
  add('GET', '/api/workspaces', getWorkspaces);
  add('POST', '/api/workspaces', postWorkspaces, true);
  add('GET', '/api/workspaces/:workspaceId', getWorkspace);
  add('GET', '/api/workspaces/:workspaceId/members', getMembers);
  add('POST', '/api/workspaces/:workspaceId/members', postMember, true);
  add('PATCH', '/api/workspaces/:workspaceId/members/:userId', patchMember, true);
  add('GET', '/api/workspaces/:workspaceId/standards', getStandardsRoute);
  add('PUT', '/api/workspaces/:workspaceId/standards', putStandards, true);
  add('GET', '/api/workspaces/:workspaceId/layouts', getLayouts);
  add('POST', '/api/workspaces/:workspaceId/layouts', postLayout, true);
  add('GET', '/api/workspaces/:workspaceId/layouts/:layoutId', getLayoutRoute);
  add('GET', '/api/workspaces/:workspaceId/layouts/:layoutId/blocks', getLayoutBlocks);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/check', postCheck);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/modules', postModule, true);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/modules/:moduleId/trash', postTrashModule, true);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/trash/:moduleId/undo', postUndoModule, true);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/trash/:moduleId/purge', postPurgeModule, true);
  add('GET', '/api/workspaces/:workspaceId/layouts/:layoutId/trash', getTrash);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/modules/:moduleId/pieces', postPiece, true);
  add('PATCH', '/api/workspaces/:workspaceId/layouts/:layoutId/modules/:moduleId/pieces/:pieceId', patchPiece, true);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/modules/:moduleId/pieces/:pieceId/remove', postRemovePiece, true);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/blocks', postBlock, true);
  add('PATCH', '/api/workspaces/:workspaceId/layouts/:layoutId/blocks/:blockId', patchBlock, true);
  add('PATCH', '/api/workspaces/:workspaceId/layouts/:layoutId/stations/:stationId', patchStation, true);
  add('PUT', '/api/workspaces/:workspaceId/layouts/:layoutId/timetable', putTimetable, true);
  add('GET', '/api/workspaces/:workspaceId/layouts/:layoutId/history', getHistory);
  add('GET', '/api/workspaces/:workspaceId/layouts/:layoutId/events', getLayoutEvents);
  add('GET', '/api/workspaces/:workspaceId/layouts/:layoutId/versions', getVersions);
  add('GET', '/api/workspaces/:workspaceId/layouts/:layoutId/versions/:versionId', getVersion);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/versions', postVersion, true);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/versions/:versionId/validate', postValidate, true);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/versions/:versionId/publish', postPublish, true);
  add('POST', '/api/workspaces/:workspaceId/layouts/:layoutId/versions/:versionId/restore', postRestore, true);
  add('GET', '/api/workspaces/:workspaceId/sessions', getSessions);
  add('POST', '/api/workspaces/:workspaceId/sessions', postSession, true);
  add('GET', '/api/workspaces/:workspaceId/sessions/:sessionId', getSessionRoute);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/start', postSessionStart, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/hold', postSessionHold, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/resume', postSessionResume, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/end', postSessionEnd, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/trains', postTrain, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/trains/:trainId/route-preview', postRoutePreview);
  add('GET', '/api/workspaces/:workspaceId/sessions/:sessionId/blocks', getSessionBlocks);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/trains/:trainId/authorities', postAuthority, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/authorities/:authorityId/cancel', postCancelAuthority, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/trains/:trainId/back-to-loop', postBackToLoop, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/trains/:trainId/recall', postRecall, true);
  add('PATCH', '/api/workspaces/:workspaceId/sessions/:sessionId/conflicts/:conflictId', patchConflict, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/conflicts/:conflictId/withdraw', postWithdraw, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/blocks/:blockId/service', postBlockService, true);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/turnouts/:turnoutId/throw', postTurnoutThrow, true);
  add('GET', '/api/workspaces/:workspaceId/sessions/:sessionId/events', getSessionEvents);
  add('GET', '/api/workspaces/:workspaceId/sessions/:sessionId/packets', getPackets);
  add('GET', '/api/workspaces/:workspaceId/sessions/:sessionId/packets/preview', getPacketPreview);
  add('POST', '/api/workspaces/:workspaceId/sessions/:sessionId/packets', postPacket, true);
  add('GET', '/api/workspaces/:workspaceId/sessions/:sessionId/packets/:packetId', getPacket);
  add('GET', '/api/workspaces/:workspaceId/sessions/:sessionId/packets/:packetId/pdf', getPacketPdf);
  return routes;
}

function matchRoute(method: string, segments: string[]): { route: Route; params: Record<string, string> } | null {
  for (const r of routeTable()) {
    if (r.method !== method) continue;
    if (r.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.pattern.length; i++) {
      const p = r.pattern[i];
      const s = segments[i];
      if (!p || !s) {
        ok = false;
        break;
      }
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s);
      else if (p !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

async function readBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<{ raw: string; parsed: unknown } | ApiError> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      return errors.bodyTooLarge();
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return { raw: '', parsed: undefined };
  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch {
    return errors.badJson();
  }
}

function writeJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (Buffer.isBuffer(body)) {
    res.writeHead(status, headers);
    res.end(body);
    return;
  }
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

export async function handleApi(ctx: RouteContext, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return false;

  res.setHeader('X-Gandyboard-Instance', ctx.instanceId);

  const segments = pathname.split('/').filter((s) => s !== '');
  const match = matchRoute(req.method ?? 'GET', segments);
  if (!match) {
    writeJson(res, 404, { error: { code: 'not_found', message: errors.notFound().message } });
    return true;
  }

  // Server boundary checks first: 413, 400, 415 before the error order.
  const method = req.method ?? 'GET';
  const contentType = req.headers['content-type'] ?? '';
  const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH';
  let body: unknown = undefined;
  let rawBody = '';
  if (isWrite || method === 'POST') {
    const contentLength = Number(req.headers['content-length'] ?? '0');
    if (contentLength > MAX_BODY) {
      writeJson(res, 413, { error: { code: 'body_too_large', message: errors.bodyTooLarge().message } });
      return true;
    }
    if (contentLength > 0 && contentType && !contentType.includes('application/json')) {
      writeJson(res, 415, { error: { code: 'bad_content_type', message: errors.badContentType().message } });
      return true;
    }
    const parsed = await readBody(req, res);
    if (parsed instanceof ApiError) {
      writeJson(res, parsed.status, { error: { code: parsed.code, message: parsed.message, ...parsed.extra } });
      return true;
    }
    rawBody = parsed.raw;
    body = parsed.parsed;
  }

  const token = tokenFromCookie(req.headers.cookie);
  const session = await readAuthSession(ctx.db, token);
  const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? (req.headers['idempotency-key'] as string) : null;

  const rctx: RequestContext = {
    req,
    res,
    method,
    path: pathname,
    query: url.searchParams,
    body,
    rawBody,
    userId: session?.userId ?? null,
    user: session ? { id: session.userId, email: session.email, display_name: session.displayName, walkthrough_done: session.walkthroughDone } : null,
    workspaceId: null,
    role: null,
    idempotencyKey,
    params: match.params,
  };

  // The published error order: a keyed write answers idempotency_key_required
  // at step 4, before any handler validation of the fields.
  if (match.route.keyed) {
    if (!session) {
      writeJson(res, 401, { error: { code: 'session_required', message: ERROR_COPY.session_required } });
      return true;
    }
    if (!idempotencyKey || idempotencyKey.length < 1 || idempotencyKey.length > 128) {
      writeJson(res, 422, { error: { code: 'idempotency_key_required', message: ERROR_COPY.idempotency_key_required } });
      return true;
    }
  }

  try {
    const result = await match.route.handler(ctx, rctx);
    const headers = { ...result.headers };
    writeJson(res, result.status, result.body ?? null, headers);
  } catch (err) {
    if (err instanceof ApiError) {
      writeJson(res, err.status, { error: { code: err.code, message: err.message, ...err.extra } });
    } else {
      console.error('unhandled', err);
      writeJson(res, 500, { error: { code: 'internal', message: 'Something went wrong.' } });
    }
  }
  return true;
}

// ---------- health, status, ops ----------

async function getHealth(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  return { status: 200, body: { status: 'ok' } };
}

async function getStatus(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  requireSession(req);
  const [valkeyUp, gotenbergUp] = await Promise.all([ctx.valkey.probe(), ctx.gotenberg.probe()]);
  return {
    status: 200,
    body: { valkey: valkeyUp ? 'up' : 'down', gotenberg: gotenbergUp ? 'up' : 'down', instance: ctx.instanceId },
  };
}

async function getOpsInstances(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const user = requireFounder(ctx, req);
  const instances = ctx.instances.map((i) => ({
    id: i.id,
    up: i.up,
    leases: i.up ? [] : [],
  }));
  return { status: 200, body: { instances } };
}

async function postOpsStop(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  requireFounder(ctx, req);
  const id = req.params['id'] ?? '';
  const body = req.body as { restart_after_ms?: number } | undefined;
  const ms = body?.restart_after_ms;
  if (typeof ms !== 'number' || ms < 0 || ms > 60000) throw errors.invalidFields();
  const target = ctx.instances.find((i) => i.id === id);
  if (!target) throw errors.notFound();
  // The router process restarts the instance child after the delay.
  process.emit('gandyboard:stop-instance' as never, id as never, ms as never);
  return { status: 202, body: { instance: id } };
}

function requireFounder(ctx: RouteContext, req: RequestContext): { id: string } {
  const user = requireSession(req);
  return user;
}

// ---------- auth ----------

async function postSignIn(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const body = req.body as { email?: string; password?: string };
  if (typeof body?.email !== 'string' || typeof body?.password !== 'string' || body.email === '' || body.password === '') {
    throw errors.invalidFields();
  }
  const res = await ctx.db.query('SELECT id, email, display_name, password_hash, walkthrough_done FROM app_users WHERE email = $1', [body.email]);
  const row = res.rows[0];
  if (!row || !verifyPassword(body.password, row.password_hash)) throw errors.invalidCredentials();
  const token = await createAuthSession(ctx.db, row.id);
  return {
    status: 200,
    body: { user: { id: row.id, email: row.email, display_name: row.display_name }, idle_seconds: 1800 },
    headers: { 'Set-Cookie': `gandyboard_session=${token}; Path=/; HttpOnly; SameSite=Lax` },
  };
}

async function postSignOut(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const token = tokenFromCookie(req.req.headers.cookie);
  await destroyAuthSession(ctx.db, token);
  return { status: 204, body: null, headers: { 'Set-Cookie': 'gandyboard_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' } };
}

async function getMe(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const user = requireSession(req);
  const memberships = await ctx.db.query(
    `SELECT m.workspace_id, w.name AS workspace_name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.workspace_id`,
    [user.id],
  );
  return {
    status: 200,
    body: {
      user: { id: user.id, email: user.email, display_name: user.display_name, walkthrough_done: user.walkthrough_done },
      memberships: memberships.rows.map((r: { workspace_id: string; workspace_name: string; role: string }) => ({
        workspace_id: r.workspace_id,
        workspace_name: r.workspace_name,
        role: r.role,
      })),
    },
  };
}

async function postWalkthrough(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const user = requireSession(req);
  const body = req.body as { done?: boolean };
  if (body?.done !== true) throw errors.invalidFields();
  await ctx.db.query('UPDATE app_users SET walkthrough_done = true WHERE id = $1', [user.id]);
  return { status: 200, body: { walkthrough_done: true } };
}

function requireSession(req: RequestContext): { id: string; email: string; display_name: string; walkthrough_done: boolean } {
  if (!req.user) throw errors.sessionRequired();
  return req.user;
}

// ---------- workspaces ----------

async function resolveWorkspace(ctx: RouteContext, req: RequestContext, requireRole: Role[] | null): Promise<{ workspaceId: string; role: Role }> {
  const user = requireSession(req);
  const workspaceId = req.params['workspaceId'] ?? '';
  const role = await roleIn(ctx.db, workspaceId, user.id);
  if (!role) {
    const exists = await ctx.db.query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if ((exists.rowCount ?? 0) === 0) throw errors.forbidden();
    throw errors.forbidden();
  }
  if (requireRole && !requireRole.includes(role)) throw errors.forbidden();
  return { workspaceId, role };
}

async function getWorkspaces(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const user = requireSession(req);
  const res = await ctx.db.query(
    `SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY w.id`,
    [user.id],
  );
  const rows: { id: string; name: string; role: string }[] = res.rows.map((r: { id: string; name: string; role: string }) => ({ id: r.id, name: r.name, role: r.role }));
  return { status: 200, body: { workspaces: rows } };
}

async function postWorkspaces(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const user = requireSession(req);
  const founderRole = await isFounder(ctx, user.id);
  if (!founderRole) throw errors.forbidden();
  const body = req.body as { name?: string; template?: string };
  if (typeof body?.name !== 'string' || body.name.trim() === '' || !['reference', 'empty'].includes(body.template ?? '')) {
    throw errors.invalidFields();
  }
  const id = `ws-${randomId()}`;
  await ctx.db.query('INSERT INTO workspaces (id, name) VALUES ($1,$2)', [id, body.name.trim()]);
  const profile: StandardsProfile = {
    endplate_single_mm: 610,
    endplate_double_mm: 660,
    double_track_offset_mm: 25,
    end_straight_mm: 152,
    min_radius_mm: 1067,
    max_grade_tenths_percent: 20,
    min_frog_number: 6,
    reverse_curve_straight_mm: 305,
    elevation_step_hundredths_mm: 1905,
    display_units: 'in',
  };
  await ctx.db.query('INSERT INTO standards (workspace_id, profile, revision) VALUES ($1,$2,1)', [id, JSON.stringify(profile)]);
  await ctx.db.query('INSERT INTO memberships (workspace_id, user_id, role, revision) VALUES ($1,$2,$3,1)', [id, user.id, 'founder']);

  const layoutId = `lay-${randomId()}`;
  let version: { id: string } | null = null;
  if (body.template === 'reference') {
    const content = buildReferenceContent();
    content.timetable.version = 1;
    const hash = canonicalHash(content);
    // The layout row exists first so the version row can reference it.
    await ctx.db.query(
      `INSERT INTO layouts (id, workspace_id, name, revision, working_hash, content) VALUES ($1,$2,$3,1,$4,$5)`,
      [layoutId, id, `${body.name.trim()} layout`, hash, JSON.stringify(content)],
    );
    const versionId = `ver-${randomId()}`;
    await ctx.db.query(
      `INSERT INTO layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by, timetable_version)
       VALUES ($1,$2,1,'Published','Version 1',$3,$4,$5,1)`,
      [versionId, layoutId, hash, JSON.stringify(content), user.id],
    );
    version = { id: versionId };
  } else {
    const emptyContent: LayoutContent = {
      modules: [], blocks: [], stations: [], turnouts: [], trains: [],
      timetable: { version: 1, entries: [] },
    };
    await ctx.db.query(
      `INSERT INTO layouts (id, workspace_id, name, revision, working_hash, content) VALUES ($1,$2,$3,1,$4,$5)`,
      [layoutId, id, `${body.name.trim()} layout`, canonicalHash(emptyContent), JSON.stringify(emptyContent)],
    );
  }
  return { status: 201, body: { workspace: { id, name: body.name.trim() }, layout: { id: layoutId }, version } };
}

async function isFounder(ctx: RouteContext, userId: string): Promise<boolean> {
  const res = await ctx.db.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND role = 'founder' LIMIT 1`, [userId]);
  return (res.rowCount ?? 0) > 0;
}

async function getWorkspace(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, role } = await resolveWorkspace(ctx, req, null);
  const standards = await getStandards(ctx.db, workspaceId);
  const counts = await ctx.db.query(
    `SELECT
      (SELECT count(*) FROM memberships WHERE workspace_id = $1) AS members,
      (SELECT count(*) FROM layouts WHERE workspace_id = $1) AS layouts,
      (SELECT count(*) FROM run_sessions WHERE workspace_id = $1) AS sessions`,
    [workspaceId],
  );
  const c = counts.rows[0];
  return {
    status: 200,
    body: {
      id: workspaceId,
      name: (await ctx.db.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId])).rows[0]?.name,
      role,
      standards: standards.profile,
      counts: { members: Number(c.members), layouts: Number(c.layouts), sessions: Number(c.sessions) },
    },
  };
}

async function getMembers(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, null);
  const res = await ctx.db.query(
    `SELECT m.user_id, m.role, m.revision, u.display_name, u.email
     FROM memberships m JOIN app_users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.user_id`,
    [workspaceId],
  );
  return {
    status: 200,
    body: {
      members: res.rows.map((r: { user_id: string; role: string; revision: string; display_name: string; email: string }) => ({
        user_id: r.user_id,
        display_name: r.display_name,
        email: r.email,
        role: r.role,
        revision: Number(r.revision),
      })),
    },
  };
}

async function postMember(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager']);
  const body = req.body as { display_name?: string; email?: string; password?: string; role?: string };
  if (!validMember(body)) throw errors.invalidFields();
  const existingUser = await ctx.db.query('SELECT id FROM app_users WHERE email = $1', [body.email]);
  let userId = existingUser.rows[0]?.id as string | undefined;
  if (userId) {
    const already = await ctx.db.query('SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
    if ((already.rowCount ?? 0) > 0) throw errors.memberExists();
  } else {
    userId = `u-${randomId()}`;
    await ctx.db.query(
      'INSERT INTO app_users (id, email, display_name, password_hash, walkthrough_done) VALUES ($1,$2,$3,$4,false)',
      [userId, body.email, body.display_name, hashPassword(body.password ?? '')],
    );
  }
  await ctx.db.query(
    'INSERT INTO memberships (workspace_id, user_id, role, revision) VALUES ($1,$2,$3,1)',
    [workspaceId, userId, body.role],
  );
  return {
    status: 201,
    body: { member: { user_id: userId, display_name: body.display_name, email: body.email, role: body.role, revision: 1 } },
  };
}

function validMember(body: { display_name?: string; email?: string; password?: string; role?: string } | undefined): body is { display_name: string; email: string; password: string; role: Role } {
  if (!body) return false;
  if (typeof body.display_name !== 'string' || body.display_name.trim() === '') return false;
  if (typeof body.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return false;
  if (typeof body.password !== 'string' || body.password.length < 6) return false;
  if (!['manager', 'member', 'operator'].includes(body.role ?? '')) return false;
  return true;
}

async function patchMember(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager']);
  const userId = req.params['userId'] ?? '';
  const body = req.body as { revision?: number; role?: string };
  if (typeof body?.revision !== 'number' || !['manager', 'member', 'operator'].includes(body.role ?? '')) throw errors.invalidFields();
  const res = await ctx.db.query(
    'UPDATE memberships SET role = $3, revision = revision + 1 WHERE workspace_id = $1 AND user_id = $2 AND revision = $4 RETURNING user_id, role, revision',
    [workspaceId, userId, body.role, body.revision],
  );
  const row = res.rows[0];
  if (!row) throw errors.staleRevision();
  return { status: 200, body: { member: { user_id: row.user_id, role: row.role, revision: Number(row.revision) } } };
}

async function getStandardsRoute(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, null);
  const standards = await getStandards(ctx.db, workspaceId);
  return { status: 200, body: { ...standards.profile, revision: standards.revision } };
}

async function putStandards(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager']);
  const body = req.body as Partial<StandardsProfile> & { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const current = await getStandards(ctx.db, workspaceId);
  if (current.revision !== body.revision) throw errors.staleRevision();
  const fields: (keyof StandardsProfile)[] = [
    'endplate_single_mm', 'endplate_double_mm', 'double_track_offset_mm', 'end_straight_mm',
    'min_radius_mm', 'max_grade_tenths_percent', 'min_frog_number', 'reverse_curve_straight_mm',
    'elevation_step_hundredths_mm', 'display_units',
  ];
  const next: StandardsProfile = { ...current.profile };
  for (const f of fields) {
    const value = body[f];
    if (value === undefined) continue;
    if (f === 'display_units') {
      if (value !== 'in' && value !== 'mm') throw errors.invalidFields();
      next.display_units = value;
    } else if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw errors.invalidFields();
    } else {
      (next as unknown as Record<string, unknown>)[f] = value;
    }
  }
  const res = await ctx.db.query(
    'UPDATE standards SET profile = $3, revision = revision + 1 WHERE workspace_id = $1 AND revision = $2 RETURNING revision',
    [workspaceId, current.revision, JSON.stringify(next)],
  );
  if (!res.rows[0]) throw errors.staleRevision();
  return { status: 200, body: { ...next, revision: Number(res.rows[0].revision) } };
}

// ---------- layouts ----------

async function getLayouts(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, null);
  const res = await ctx.db.query(
    'SELECT id, name, revision, content FROM layouts WHERE workspace_id = $1 ORDER BY id',
    [workspaceId],
  );
  const layouts = res.rows.map((r: { id: string; name: string; revision: string; content: LayoutContent }) => ({
    id: r.id,
    name: r.name,
    revision: Number(r.revision),
    counts: layoutCounts(r.content),
  }));
  return { status: 200, body: { layouts } };
}

async function postLayout(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'member']);
  const body = req.body as { name?: string };
  if (typeof body?.name !== 'string' || body.name.trim() === '') throw errors.invalidFields();
  const id = `lay-${randomId()}`;
  const content: LayoutContent = { modules: [], blocks: [], stations: [], turnouts: [], trains: [], timetable: { version: 1, entries: [] } };
  await ctx.db.query(
    'INSERT INTO layouts (id, workspace_id, name, revision, working_hash, content) VALUES ($1,$2,$3,1,$4,$5)',
    [id, workspaceId, body.name.trim(), canonicalHash(content), JSON.stringify(content)],
  );
  return { status: 201, body: { layout: { id, name: body.name.trim(), revision: 1, counts: layoutCounts(content) } } };
}

async function loadLayout(ctx: RouteContext, req: RequestContext, roles: Role[] | null): Promise<{ workspaceId: string; layout: LayoutRow2 }> {
  const { workspaceId, role } = await resolveWorkspace(ctx, req, roles);
  const layoutId = req.params['layoutId'] ?? '';
  const res = await ctx.db.query('SELECT id, workspace_id, name, revision, working_hash, content FROM layouts WHERE id = $1 AND workspace_id = $2', [layoutId, workspaceId]);
  const row = res.rows[0];
  if (!row) throw errors.notFound();
  return { workspaceId, layout: { ...row, revision: Number(row.revision), content: row.content as LayoutContent } };
}

interface LayoutRow2 {
  id: string;
  workspace_id: string;
  name: string;
  revision: number;
  working_hash: string;
  content: LayoutContent;
}

async function getLayoutRoute(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { layout } = await loadLayout(ctx, req, null);
  const moduleRevisions: Record<string, number> = {};
  layout.content.modules.forEach((m, i) => {
    moduleRevisions[m.id] = layout.revision * 100 + i;
  });
  return {
    status: 200,
    body: {
      id: layout.id,
      name: layout.name,
      revision: layout.revision,
      working_hash: layout.working_hash,
      content: layout.content,
      module_revisions: moduleRevisions,
      counts: layoutCounts(layout.content),
    },
  };
}

async function getLayoutBlocks(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { layout } = await loadLayout(ctx, req, null);
  const q = (req.query.get('q') ?? '').toLowerCase();
  let blocks = layout.content.blocks.map((b) => ({ id: b.id, number: b.number, name: b.name, kind: b.kind }));
  if (q) {
    blocks = blocks.filter((b) => b.name.toLowerCase().includes(q) || String(b.number).includes(q));
  }
  return { status: 200, body: { blocks } };
}

async function postCheck(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, ['founder', 'manager', 'member']);
  const standards = await getStandards(ctx.db, workspaceId);
  const findings = checkLayout(standards.profile, layout.content.modules);
  return { status: 200, body: { passed: findings.length === 0, findings } };
}

// ---------- pieces, modules ----------

function requireIdempotency(req: RequestContext): string {
  const key = req.idempotencyKey;
  if (!key || key.length < 1 || key.length > 128) throw errors.idempotencyKeyRequired();
  return key;
}

async function withKey(
  ctx: RouteContext,
  req: RequestContext,
  workspaceId: string,
  fn: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown }> {
  const key = requireIdempotency(req);
  const result = await withIdempotency(ctx.db, workspaceId, req.user?.id ?? '', key, hashBody(req.rawBody), async () => fn());
  return { status: result.status, body: result.body };
}

async function postModule(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, ['founder', 'manager', 'member']);
  const user = requireSession(req);
  const body = req.body as {
    revision?: number;
    name?: string;
    endplates?: { end?: string; width_mm?: number; track_offsets_mm?: number[] }[];
  };
  if (typeof body?.revision !== 'number' || typeof body.name !== 'string' || body.name.trim() === '' || !Array.isArray(body.endplates)) {
    throw errors.invalidFields();
  }
  if (body.revision !== layout.revision) throw errors.staleRevision();
  for (const ep of body.endplates) {
    if (ep.end !== 'A' && ep.end !== 'B') throw errors.invalidFields();
    if (typeof ep.width_mm !== 'number' || !Array.isArray(ep.track_offsets_mm)) throw errors.invalidFields();
  }
  const moduleName = body.name.trim();
  const endplatesInput = body.endplates;
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row || Number(row.revision) !== layout.revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const content = row.content as LayoutContent;
      const moduleId = `mod-${randomId()}`;
      const endplates = endplatesInput.map((ep) => ({
        end: ep.end as 'A' | 'B',
        width_mm: ep.width_mm as number,
        track_offsets_mm: ep.track_offsets_mm as number[],
      }));
      const startOpenEnds = endplates.map((ep, i) => ({
        id: `oe-${randomId()}`,
        label: `${moduleName} ${ep.end}`,
        x_mm: 0,
        y_mm: i === 0 ? 0 : 200,
        elevation_mm: 0,
        heading_deg: 0,
        parent_piece_id: null,
      }));
      content.modules.push({
        id: moduleId,
        name: moduleName,
        endplates,
        pieces: [],
        open_ends: startOpenEnds,
        trashed: false,
        trashed_by: null,
        trashed_at: null,
      });
      content.modules.sort((a, b) => a.id.localeCompare(b.id));
      const hash = canonicalHash(content);
      const newRevision = layout.revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'module.created', moduleId, null, moduleName);
      await commitLayoutEvent(client, { id: layout.id, revision: layout.revision }, 'module.changed', { module_id: moduleId, name: moduleName }, user.id);
      await client.query('COMMIT');
      return {
        status: 201,
        body: {
          module: content.modules.find((m) => m.id === moduleId),
          layout_revision: newRevision,
        },
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

const WRITE_ROLES: Role[] = ['founder', 'manager', 'member'];

async function postPiece(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, WRITE_ROLES);
  const user = requireSession(req);
  const body = req.body as { revision?: number; open_end_id?: string; piece?: PieceInput };
  if (typeof body?.revision !== 'number' || typeof body.open_end_id !== 'string' || !body.piece) throw errors.invalidFields();
  const moduleId = req.params['moduleId'] ?? '';
  const standards = await getStandards(ctx.db, workspaceId);
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      const revision = Number(row.revision);
      const content = row.content as LayoutContent;
      const module = content.modules.find((m) => m.id === moduleId);
      if (!module) throw errors.notFound();
      const openEnd = module.open_ends.find((o) => o.id === body.open_end_id);
      // A stale revision with the end already consumed is an open-end conflict,
      // naming who took it; a stale revision with the end still open is stale.
      if (body.revision !== revision) {
        await client.query('COMMIT');
        if (!openEnd) {
          const other = await client.query(
            `SELECT u.display_name FROM layout_history h JOIN app_users u ON u.id = h.actor
             WHERE h.layout_id = $1 AND h.action = 'piece.added' ORDER BY h.at DESC LIMIT 1`,
            [layout.id],
          );
          const who = other.rows[0]?.display_name ?? 'another member';
          throw errors.openEndTaken(body.open_end_id ?? 'that end', who, '');
        }
        throw errors.staleRevision();
      }
      if (!openEnd) {
        await client.query('COMMIT');
        throw errors.notFound();
      }
      const input = body.piece as PieceInput & { rise_mm?: number; mainline?: boolean };
      const findings = checkPieceRules(standards.profile, input, module.pieces[module.pieces.length - 1] ?? null, straightRunAtEnd(module));
      if (findings.length > 0) {
        await client.query('COMMIT');
        throw errors.validationFailed(findings);
      }
      const piece = buildPieceRecord(`pc-${randomId()}`, input, {
        x_mm: openEnd.x_mm,
        y_mm: openEnd.y_mm,
        elevation_mm: openEnd.elevation_mm,
        heading_deg: openEnd.heading_deg,
      }, module.pieces[0]?.block_id ?? null, input.rise_mm ?? 0);
      module.pieces.push(piece);
      module.open_ends = module.open_ends.filter((o) => o.id !== openEnd.id);
      if (piece.kind === 'turnout') {
        module.open_ends.push({
          id: `oe-${randomId()}`,
          label: `${module.name} through`,
          x_mm: piece.end.x_mm,
          y_mm: piece.end.y_mm,
          elevation_mm: piece.end.elevation_mm,
          heading_deg: piece.end.heading_deg,
          parent_piece_id: piece.id,
        });
        module.open_ends.push({
          id: `oe-${randomId()}`,
          label: `${module.name} diverging`,
          x_mm: piece.end.x_mm,
          y_mm: piece.end.y_mm,
          elevation_mm: piece.end.elevation_mm,
          heading_deg: piece.end.heading_deg - 10,
          parent_piece_id: piece.id,
        });
      } else {
        module.open_ends.push({
          id: `oe-${randomId()}`,
          label: `${module.name} B`,
          x_mm: piece.end.x_mm,
          y_mm: piece.end.y_mm,
          elevation_mm: piece.end.elevation_mm,
          heading_deg: piece.end.heading_deg,
          parent_piece_id: piece.id,
        });
      }
      const hash = canonicalHash(content);
      const newRevision = revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'piece.added', piece.id, null, piece.kind);
      await commitLayoutEvent(client, { id: layout.id, revision: revision }, 'piece.added', { piece, module_id: moduleId }, user.id);
      await client.query('COMMIT');
      return {
        status: 201,
        body: {
          piece,
          open_ends: module.open_ends,
          module_revision: newRevision,
          layout_revision: newRevision,
          working_hash: hash,
        },
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

/** Straight run at the working end of a module, for the reverse-curve rule. */
function straightRunAtEnd(module: LayoutContent['modules'][number]): number {
  let sum = 0;
  for (let i = module.pieces.length - 1; i >= 0; i--) {
    const p = module.pieces[i];
    if (!p) break;
    if (p.kind === 'straight' || p.kind === 'turnout') sum += p.length_mm;
    else break;
  }
  return sum;
}

async function patchPiece(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, WRITE_ROLES);
  const user = requireSession(req);
  const body = req.body as { revision?: number; rise_mm?: number; block_id?: string | null; note?: string };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const moduleId = req.params['moduleId'] ?? '';
  const pieceId = req.params['pieceId'] ?? '';
  const standards = await getStandards(ctx.db, workspaceId);
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      const revision = Number(row.revision);
      if (body.revision !== revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const content = row.content as LayoutContent;
      const module = content.modules.find((m) => m.id === moduleId);
      if (!module) throw errors.notFound();
      const pieceIndex = module.pieces.findIndex((p) => p.id === pieceId);
      if (pieceIndex < 0) throw errors.notFound();
      const piece = module.pieces[pieceIndex];
      if (!piece) throw errors.notFound();
      const rise = body.rise_mm !== undefined ? body.rise_mm : piece.rise_mm;
      if (typeof rise !== 'number') throw errors.invalidFields();
      // Grade rule checked on edit with the changed rise.
      if (Math.abs(rise) * 1000 > standards.profile.max_grade_tenths_percent * piece.length_mm) {
        const measured = roundHalfUpTenths(Math.abs(rise) * 1000 / Math.max(piece.length_mm, 1));
        await client.query('COMMIT');
        throw errors.validationFailed([{
          rule: 'max_grade',
          module_id: module.id,
          piece_id: piece.id,
          measured_mm: measured,
          limit_mm: standards.profile.max_grade_tenths_percent,
          message: `Grade ${(measured / 10).toFixed(1)}% is over the ${(standards.profile.max_grade_tenths_percent / 10).toFixed(1)}% maximum.`,
        }]);
      }
      piece.rise_mm = rise;
      if (body.block_id !== undefined) {
        if (body.block_id !== null && !content.blocks.find((b) => b.id === body.block_id)) throw errors.notFound();
        piece.block_id = body.block_id;
      }
      if (body.note !== undefined) {
        if (typeof body.note !== 'string') throw errors.invalidFields();
        piece.note = body.note;
      }
      const hash = canonicalHash(content);
      const newRevision = revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'piece.changed', piece.id, null, null);
      await commitLayoutEvent(client, { id: layout.id, revision }, 'piece.changed', { piece, module_id: moduleId }, user.id);
      await client.query('COMMIT');
      return {
        status: 200,
        body: {
          piece,
          module_revision: newRevision,
          layout_revision: newRevision,
          working_hash: hash,
        },
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

function roundHalfUpTenths(n: number): number {
  const f = Math.floor(n);
  const diff = n - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f + 1;
}

async function postRemovePiece(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, WRITE_ROLES);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const moduleId = req.params['moduleId'] ?? '';
  const pieceId = req.params['pieceId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      const revision = Number(row.revision);
      if (body.revision !== revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const content = row.content as LayoutContent;
      const module = content.modules.find((m) => m.id === moduleId);
      if (!module) throw errors.notFound();
      const index = module.pieces.findIndex((p) => p.id === pieceId);
      if (index < 0) throw errors.notFound();
      // Removing a piece others follow is refused.
      for (const other of module.pieces) {
        if (other.start.x_mm === module.pieces[index]?.end.x_mm && other.start.y_mm === module.pieces[index]?.end.y_mm) {
          if (other.id !== pieceId) {
            await client.query('COMMIT');
            throw new ApiError(422, 'piece_has_followers', 'Remove the pieces after this one first.');
          }
        }
      }
      const removed = module.pieces.splice(index, 1)[0];
      if (!removed) throw errors.notFound();
      module.open_ends = module.open_ends.filter((o) => o.parent_piece_id !== pieceId);
      module.open_ends.push({
        id: `oe-${randomId()}`,
        label: `${module.name} B`,
        x_mm: removed.start.x_mm,
        y_mm: removed.start.y_mm,
        elevation_mm: removed.start.elevation_mm,
        heading_deg: removed.start.heading_deg,
        parent_piece_id: removed.id,
      });
      const hash = canonicalHash(content);
      const newRevision = revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'piece.removed', pieceId, null, null);
      await commitLayoutEvent(client, { id: layout.id, revision }, 'piece.removed', { piece_id: pieceId, module_id: moduleId }, user.id);
      await client.query('COMMIT');
      return {
        status: 200,
        body: {
          open_ends: module.open_ends,
          module_revision: newRevision,
          layout_revision: newRevision,
          working_hash: hash,
        },
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postTrashModule(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, WRITE_ROLES);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const moduleId = req.params['moduleId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      const revision = Number(row.revision);
      if (body.revision !== revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const content = row.content as LayoutContent;
      const module = content.modules.find((m) => m.id === moduleId && !m.trashed);
      if (!module) throw errors.notFound();
      module.trashed = true;
      module.trashed_by = user.display_name;
      module.trashed_at = new Date().toISOString();
      const hash = canonicalHash(content);
      const newRevision = revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'module.trashed', moduleId, module.name, null);
      await commitLayoutEvent(client, { id: layout.id, revision }, 'module.changed', { module_id: moduleId, trashed: true }, user.id);
      await client.query('COMMIT');
      return { status: 200, body: { layout_revision: newRevision, working_hash: hash } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postUndoModule(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, WRITE_ROLES);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const moduleId = req.params['moduleId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      const revision = Number(row.revision);
      if (body.revision !== revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const content = row.content as LayoutContent;
      const module = content.modules.find((m) => m.id === moduleId && m.trashed);
      if (!module) throw errors.notFound();
      module.trashed = false;
      module.trashed_by = null;
      module.trashed_at = null;
      const hash = canonicalHash(content);
      const newRevision = revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'module.restored', moduleId, null, module.name);
      await commitLayoutEvent(client, { id: layout.id, revision }, 'module.changed', { module_id: moduleId, trashed: false }, user.id);
      await client.query('COMMIT');
      return { status: 200, body: { module, layout_revision: newRevision, working_hash: hash } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postPurgeModule(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, WRITE_ROLES);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const moduleId = req.params['moduleId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      const revision = Number(row.revision);
      if (body.revision !== revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const content = row.content as LayoutContent;
      const module = content.modules.find((m) => m.id === moduleId && m.trashed);
      if (!module) throw errors.notFound();
      content.modules = content.modules.filter((m) => m.id !== moduleId);
      const hash = canonicalHash(content);
      const newRevision = revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'module.purged', moduleId, module.name, null);
      // Purge masks earlier history rows about this module.
      await client.query(
        `UPDATE layout_history SET action = 'purged', object_id = NULL, from_value = NULL, to_value = NULL WHERE layout_id = $1 AND object_id = $2`,
        [layout.id, moduleId],
      );
      await commitLayoutEvent(client, { id: layout.id, revision }, 'module.changed', { module_id: moduleId, purged: true }, user.id);
      await client.query('COMMIT');
      return { status: 200, body: { layout_revision: newRevision } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function getTrash(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { layout } = await loadLayout(ctx, req, null);
  const modules = layout.content.modules.filter((m) => m.trashed).map((m) => ({
    id: m.id,
    name: m.name,
    trashed_by: m.trashed_by,
    trashed_at: m.trashed_at,
  }));
  return { status: 200, body: { modules } };
}

async function postBlock(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, WRITE_ROLES);
  const user = requireSession(req);
  const body = req.body as { revision?: number; name?: string; kind?: string };
  if (typeof body?.revision !== 'number' || typeof body.name !== 'string' || !['plain', 'loop', 'approach'].includes(body.kind ?? '')) {
    throw errors.invalidFields();
  }
  const name = body.name;
  const kind = body.kind as 'plain' | 'loop' | 'approach';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      const revision = Number(row.revision);
      if (body.revision !== revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const content = row.content as LayoutContent;
      const numbers = content.blocks.map((b) => b.number);
      const number = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
      const block = { id: `blk-${randomId()}`, number, name: name.trim(), kind, length_mm: 0 };
      content.blocks.push(block);
      content.blocks.sort((a, b) => a.id.localeCompare(b.id));
      const hash = canonicalHash(content);
      const newRevision = revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'block.created', block.id, null, block.name);
      await commitLayoutEvent(client, { id: layout.id, revision }, 'block.changed', { block }, user.id);
      await client.query('COMMIT');
      return { status: 201, body: { block, layout_revision: newRevision } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

/** A rename updates the working copy and every non-Ended session in one commit. */
async function renameInLayout(
  ctx: RouteContext,
  client: import('./db').Tx,
  layoutId: string,
  kind: 'block' | 'station',
  objectId: string,
  newName: string,
  actorId: string,
  actorName: string,
  revision: number,
): Promise<{ layoutRevision: number }> {
  const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layoutId]);
  const row = fresh.rows[0];
  if (!row) throw errors.notFound();
  const content = row.content as LayoutContent;
  let oldName: string | null = null;
  if (kind === 'block') {
    const block = content.blocks.find((b) => b.id === objectId);
    if (!block) throw errors.notFound();
    oldName = block.name;
    block.name = newName;
  } else {
    const station = content.stations.find((s) => s.id === objectId);
    if (!station) throw errors.notFound();
    oldName = station.name;
    station.name = newName;
  }
  const hash = canonicalHash(content);
  const layoutRevision = revision + 1;
  await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layoutId, layoutRevision, hash, JSON.stringify(content)]);
  await addHistory(client, layoutId, actorId, `${kind}.renamed`, objectId, oldName, newName);
  await commitLayoutEvent(client, { id: layoutId, revision }, 'name.changed', { kind, object_id: objectId, from: oldName, to: newName }, actorId);

  // Rename in every non-Ended session of this layout in the same commit.
  const sessions = await client.query(
    `SELECT id, revision, state, status FROM run_sessions WHERE status <> 'Ended' AND layout_version_id IN (SELECT id FROM layout_versions WHERE layout_id = $1)`,
    [layoutId],
  );
  for (const s of sessions.rows) {
    const state = s.state as unknown as SessionState;
    if (kind === 'block') {
      const block = state.blocks.find((b) => b.id === objectId);
      if (block) block.name = newName;
    } else {
      // Stations are not stored in session state; packets build them at render time.
    }
    const sessionRevision = Number(s.revision) + 1;
    await client.query('UPDATE run_sessions SET revision = $2, state = $3 WHERE id = $1', [s.id, sessionRevision, JSON.stringify(state)]);
    await client.query(
      `INSERT INTO event_outbox (stream, seq, type, payload)
       VALUES ($1,$2,'name.changed',$3)`,
      [
        `gandyboard:session:${s.id as string}:events`,
        sessionRevision,
        { seq: sessionRevision, type: 'name.changed', detail: { kind, object_id: objectId, from: oldName, to: newName } },
      ],
    );
    // Ready packets of these sessions become Superseded.
    await client.query(
      `UPDATE crew_packets SET state = 'Superseded' WHERE session_id = $1 AND state = 'Ready'`,
      [s.id as string],
    );
  }
  return { layoutRevision };
}

async function patchBlock(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, ['founder', 'manager']);
  const user = requireSession(req);
  const body = req.body as { revision?: number; name?: string };
  if (typeof body?.revision !== 'number' || typeof body.name !== 'string' || body.name.trim() === '') throw errors.invalidFields();
  const newName = body.name;
  const blockId = req.params['blockId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const freshRevision = await client.query('SELECT revision FROM layouts WHERE id = $1', [layout.id]);
      if (Number(freshRevision.rows[0]?.revision) !== body.revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const result = await renameInLayout(ctx, client, layout.id, 'block', blockId, newName.trim(), user.id, user.display_name, body.revision);
      await client.query('COMMIT');
      const blockRow = await ctx.db.query('SELECT content FROM layouts WHERE id = $1', [layout.id]);
      const block = (blockRow.rows[0]?.content as LayoutContent).blocks.find((b) => b.id === blockId);
      return { status: 200, body: { block, layout_revision: result.layoutRevision } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function patchStation(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, ['founder', 'manager']);
  const user = requireSession(req);
  const body = req.body as { revision?: number; name?: string };
  if (typeof body?.revision !== 'number' || typeof body.name !== 'string' || body.name.trim() === '') throw errors.invalidFields();
  const newName = body.name;
  const stationId = req.params['stationId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const freshRevision = await client.query('SELECT revision FROM layouts WHERE id = $1', [layout.id]);
      if (Number(freshRevision.rows[0]?.revision) !== body.revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const result = await renameInLayout(ctx, client, layout.id, 'station', stationId, newName.trim(), user.id, user.display_name, body.revision);
      await client.query('COMMIT');
      const contentRow = await ctx.db.query('SELECT content FROM layouts WHERE id = $1', [layout.id]);
      const station = (contentRow.rows[0]?.content as LayoutContent).stations.find((s) => s.id === stationId);
      return { status: 200, body: { station, layout_revision: result.layoutRevision } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function putTimetable(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, ['founder', 'manager']);
  const user = requireSession(req);
  const body = req.body as {
    revision?: number;
    entries?: { id?: string; train_id?: string; station_id?: string; depart_fast_seconds?: number }[];
  };
  if (typeof body?.revision !== 'number' || !Array.isArray(body.entries)) throw errors.invalidFields();
  for (const entry of body.entries) {
    if (typeof entry.id !== 'string' || typeof entry.train_id !== 'string' || typeof entry.station_id !== 'string') throw errors.invalidFields();
    if (typeof entry.depart_fast_seconds !== 'number' || !Number.isInteger(entry.depart_fast_seconds) || entry.depart_fast_seconds < 0 || entry.depart_fast_seconds > 86399) {
      throw errors.invalidFields();
    }
  }
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      const revision = Number(row.revision);
      if (body.revision !== revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const content = row.content as LayoutContent;
      for (const entry of body.entries!) {
        if (!content.trains.find((t) => t.id === entry.train_id) || !content.stations.find((s) => s.id === entry.station_id)) {
          await client.query('COMMIT');
          throw errors.invalidFields();
        }
      }
      const nextVersion = content.timetable.version + 1;
      content.timetable = {
        version: nextVersion,
        entries: body.entries!.map((e) => ({ id: e.id as string, train_id: e.train_id as string, station_id: e.station_id as string, depart_fast_seconds: e.depart_fast_seconds as number })),
      };
      const hash = canonicalHash(content);
      const newRevision = revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'timetable.changed', null, String(nextVersion - 1), String(nextVersion));
      await commitLayoutEvent(client, { id: layout.id, revision }, 'timetable.changed', { version: nextVersion }, user.id);
      await client.query('COMMIT');
      return { status: 200, body: { timetable: content.timetable, layout_revision: newRevision } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function getHistory(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { layout } = await loadLayout(ctx, req, null);
  const objectId = req.query.get('object_id');
  const res = await ctx.db.query(
    `SELECT id, actor, at, action, object_id, from_value, to_value FROM layout_history
     WHERE layout_id = $1 AND ($2::text IS NULL OR object_id = $2)
     ORDER BY at DESC, id DESC`,
    [layout.id, objectId],
  );
  const actorNames = await ctx.db.query('SELECT id, display_name FROM app_users');
  const nameById = new Map(actorNames.rows.map((r: { id: string; display_name: string }) => [r.id, r.display_name]));
  return {
    status: 200,
    body: {
      history: res.rows.map((r: { id: string; actor: string; at: Date; action: string; object_id: string | null; from_value: string | null; to_value: string | null }) => ({
        id: r.id,
        actor: nameById.get(r.actor) ?? r.actor,
        at: new Date(r.at).toISOString(),
        action: r.action,
        object_id: r.object_id,
        from: r.from_value,
        to: r.to_value,
      })),
    },
  };
}

// ---------- versions ----------

async function getVersions(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { layout } = await loadLayout(ctx, req, null);
  const res = await ctx.db.query(
    `SELECT id, number, state, label, canonical_hash, saved_by, saved_at, restored_from, revision
     FROM layout_versions WHERE layout_id = $1 ORDER BY number`,
    [layout.id],
  );
  return {
    status: 200,
    body: {
      versions: res.rows.map((r: { id: string; number: number; state: string; label: string; canonical_hash: string; saved_by: string; saved_at: Date; restored_from: string | null; revision: string }) => ({
        id: r.id,
        number: r.number,
        state: r.state,
        label: r.label,
        canonical_hash: r.canonical_hash,
        saved_by: r.saved_by,
        saved_at: new Date(r.saved_at).toISOString(),
        restored_from: r.restored_from,
        revision: Number(r.revision),
      })),
    },
  };
}

async function getVersion(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { layout } = await loadLayout(ctx, req, null);
  const versionId = req.params['versionId'] ?? '';
  const res = await ctx.db.query(
    `SELECT id, number, state, label, canonical_hash, content, saved_by, saved_at, restored_from, revision
     FROM layout_versions WHERE layout_id = $1 AND id = $2`,
    [layout.id, versionId],
  );
  const r = res.rows[0];
  if (!r) throw errors.notFound();
  return {
    status: 200,
    body: {
      id: r.id,
      number: r.number,
      state: r.state,
      label: r.label,
      canonical_hash: r.canonical_hash,
      content: r.content,
      saved_by: r.saved_by,
      saved_at: new Date(r.saved_at).toISOString(),
      restored_from: r.restored_from,
      revision: Number(r.revision),
    },
  };
}

async function postVersion(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, WRITE_ROLES);
  const user = requireSession(req);
  const body = req.body as { revision?: number; label?: string };
  if (typeof body?.revision !== 'number' || typeof body.label !== 'string' || body.label.trim() === '') throw errors.invalidFields();
  const label = body.label;
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision, content FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      const revision = Number(row.revision);
      if (body.revision !== revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const content = row.content as LayoutContent;
      const numbers = await client.query('SELECT coalesce(max(number),0) AS n FROM layout_versions WHERE layout_id = $1', [layout.id]);
      const number = Number(numbers.rows[0]?.n ?? 0) + 1;
      const id = `ver-${randomId()}`;
      const hash = canonicalHash(content);
      await client.query(
        `INSERT INTO layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by, timetable_version)
         VALUES ($1,$2,$3,'Draft',$4,$5,$6,$7,$8)`,
        [id, layout.id, number, label.trim(), hash, JSON.stringify(content), user.id, content.timetable.version],
      );
      const newRevision = revision + 1;
      await client.query('UPDATE layouts SET revision = $2 WHERE id = $1', [layout.id, newRevision]);
      await addHistory(client, layout.id, user.id, 'version.saved', id, null, label.trim());
      await commitLayoutEvent(client, { id: layout.id, revision }, 'version.changed', { version_id: id, number, state: 'Draft' }, user.id);
      await client.query('COMMIT');
      return {
        status: 201,
        body: {
          version: {
            id, number, state: 'Draft', label: label.trim(), canonical_hash: hash,
            saved_by: user.id, saved_at: new Date().toISOString(), restored_from: null, revision: 1,
          },
          layout_revision: newRevision,
        },
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postValidate(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, WRITE_ROLES);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const versionId = req.params['versionId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      // Lock the layout row so the event seq and the layout revision agree.
      await client.query('SELECT revision FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const layoutRevision = Number((await client.query('SELECT revision FROM layouts WHERE id = $1', [layout.id])).rows[0]?.revision);
      const fresh = await client.query('SELECT id, number, state, revision, content FROM layout_versions WHERE layout_id = $1 AND id = $2 FOR UPDATE', [layout.id, versionId]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      if (body.revision !== Number(row.revision)) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      if (row.state !== 'Draft') {
        await client.query('COMMIT');
        throw errors.versionTransition(row.state);
      }
      const standards = await getStandards(ctx.db, workspaceId);
      const findings = checkLayout(standards.profile, (row.content as LayoutContent).modules);
      if (findings.length > 0) {
        await client.query('COMMIT');
        throw errors.validationFailedLayout(findings);
      }
      await client.query(`UPDATE layout_versions SET state = 'Validated', revision = revision + 1 WHERE id = $1`, [versionId]);
      await client.query('UPDATE layouts SET revision = revision + 1 WHERE id = $1', [layout.id]);
      await addHistory(client, layout.id, user.id, 'version.validated', versionId, null, null);
      await commitLayoutEvent(client, { id: layout.id, revision: layoutRevision }, 'version.changed', { version_id: versionId, state: 'Validated' }, user.id);
      const updated = await client.query('SELECT id, number, state, revision FROM layout_versions WHERE id = $1', [versionId]);
      const u = updated.rows[0];
      await client.query('COMMIT');
      return {
        status: 200,
        body: {
          version: { id: u.id, number: u.number, state: u.state, revision: Number(u.revision) },
          report: { passed: true, findings: [] },
        },
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postPublish(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, ['founder', 'manager']);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const versionId = req.params['versionId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      // Lock the layout row so the event seq and the layout revision agree.
      await client.query('SELECT revision FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      const layoutRevision = Number((await client.query('SELECT revision FROM layouts WHERE id = $1', [layout.id])).rows[0]?.revision);
      const fresh = await client.query('SELECT id, number, state, revision FROM layout_versions WHERE layout_id = $1 AND id = $2 FOR UPDATE', [layout.id, versionId]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      if (body.revision !== Number(row.revision)) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      if (row.state !== 'Validated') {
        await client.query('COMMIT');
        throw errors.versionTransition(row.state);
      }
      await client.query(`UPDATE layout_versions SET state = 'Published', revision = revision + 1 WHERE id = $1`, [versionId]);
      await client.query('UPDATE layouts SET revision = revision + 1 WHERE id = $1', [layout.id]);
      await addHistory(client, layout.id, user.id, 'version.published', versionId, null, null);
      await commitLayoutEvent(client, { id: layout.id, revision: layoutRevision }, 'version.changed', { version_id: versionId, state: 'Published' }, user.id);
      const updated = await client.query('SELECT id, number, state, revision FROM layout_versions WHERE id = $1', [versionId]);
      const u = updated.rows[0];
      await client.query('COMMIT');
      return {
        status: 200,
        body: { version: { id: u.id, number: u.number, state: u.state, revision: Number(u.revision) } },
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postRestore(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, layout } = await loadLayout(ctx, req, ['founder', 'manager']);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const versionId = req.params['versionId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT revision FROM layouts WHERE id = $1 FOR UPDATE', [layout.id]);
      if (Number(fresh.rows[0]?.revision) !== body.revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const source = await client.query('SELECT id, number, content, canonical_hash FROM layout_versions WHERE layout_id = $1 AND id = $2', [layout.id, versionId]);
      const src = source.rows[0];
      if (!src) throw errors.notFound();
      const numbers = await client.query('SELECT coalesce(max(number),0) AS n FROM layout_versions WHERE layout_id = $1', [layout.id]);
      const number = Number(numbers.rows[0]?.n ?? 0) + 1;
      const content = src.content as LayoutContent;
      const newId = `ver-${randomId()}`;
      await client.query(
        `INSERT INTO layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by, restored_from, timetable_version)
         VALUES ($1,$2,$3,'Draft',$4,$5,$6,$7,$8,$9)`,
        [newId, layout.id, number, `Restore of ${src.number}`, src.canonical_hash, JSON.stringify(content), user.id, versionId, content.timetable.version],
      );
      const newRevision = body.revision + 1;
      await client.query('UPDATE layouts SET revision = $2, working_hash = $3, content = $4 WHERE id = $1', [layout.id, newRevision, src.canonical_hash, JSON.stringify(content)]);
      await addHistory(client, layout.id, user.id, 'version.restored', newId, String(src.number), null);
      await commitLayoutEvent(client, { id: layout.id, revision: body.revision }, 'version.changed', { version_id: newId, restored_from: versionId }, user.id);
      await client.query('COMMIT');
      return {
        status: 201,
        body: {
          version: {
            id: newId, number, state: 'Draft', label: `Restore of ${src.number}`,
            canonical_hash: src.canonical_hash, saved_by: user.id, saved_at: new Date().toISOString(),
            restored_from: versionId, revision: 1,
          },
          layout_revision: newRevision,
          working_hash: src.canonical_hash,
        },
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

// ---------- events (SSE) ----------

async function getLayoutEvents(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { layout } = await loadLayout(ctx, req, null);
  const stream = `gandyboard:layout:${layout.id}:events`;
  await streamEvents(ctx, req, stream, layout.revision);
  return { status: 200, body: null };
}

async function getSessionEvents(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, null);
  const sessionId = req.params['sessionId'] ?? '';
  const res = await ctx.db.query('SELECT revision, workspace_id FROM run_sessions WHERE id = $1', [sessionId]);
  const row = res.rows[0];
  if (!row || row.workspace_id !== workspaceId) throw errors.notFound();
  const stream = `gandyboard:session:${sessionId}:events`;
  await streamEvents(ctx, req, stream, Number(row.revision));
  return { status: 200, body: null };
}

async function streamEvents(ctx: RouteContext, req: RequestContext, stream: string, currentRevision: number): Promise<void> {
  const res = req.res;
  const up = await ctx.valkey.probe();
  if (!up) throw errors.valkeyUnavailable();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const lastEventId = (req.req.headers['last-event-id'] as string | undefined) ?? req.query.get('last_event_id');
  let cursor: string;
  let cursorSeq: number;
  if (lastEventId) {
    const seq = Number(lastEventId);
    const start = await ctx.valkey.streamStart(stream);
    if (start !== null && seq < start) {
      res.write(`event: resync\ndata: ${JSON.stringify({ reason: 'replay_aged_out' })}\n\n`);
      cursorSeq = currentRevision;
    } else {
      cursorSeq = seq;
    }
    cursor = `${cursorSeq}-0`;
  } else {
    cursorSeq = currentRevision;
    cursor = `${cursorSeq}-0`;
  }

  let closed = false;
  let ended = false;
  req.req.on('close', () => {
    closed = true;
  });
  const safeWrite = (chunk: string): boolean => {
    if (closed || ended || res.writableEnded || res.destroyed) return false;
    try {
      res.write(chunk);
      return true;
    } catch {
      ended = true;
      return false;
    }
  };

  // Comment line at least every 15 seconds; poll at a short interval in between.
  let keepAliveAt = 0;
  while (!closed && !ended) {
    const entries = await ctx.valkey.readStream(stream, cursor, 100);
    if (entries === null) {
      // Valkey went away mid-stream: end so the browser reconnects.
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          // already closed
        }
      }
      ended = true;
      return;
    }
    let wrote = false;
    for (const entry of entries) {
      if (!safeWrite(`id: ${entry.id}\nevent: ${entry.type}\ndata: ${entry.payload}\n\n`)) {
        ended = true;
        break;
      }
      cursor = entry.id;
      cursorSeq = Number(entry.id.split('-')[0]);
      wrote = true;
    }
    if (ended) break;
    if (!wrote && Date.now() >= keepAliveAt) {
      if (!safeWrite(`: keep-alive\n\n`)) break;
      keepAliveAt = Date.now() + 12000;
    }
    if (!wrote) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (!res.writableEnded) {
    try {
      res.end();
    } catch {
      // already closed
    }
  }
}

// ---------- sessions ----------

interface SessionRow {
  id: string;
  name: string;
  status: string;
  hold_reason: string | null;
  ratio: number;
  revision: number;
  control_revision: number;
  session_version: number;
  tick: number;
  fast_clock_seconds: number;
  layout_version_id: string;
  layout_version_number: number;
  timetable_version: number;
  state: SessionState;
}

async function loadSession(ctx: RouteContext, req: RequestContext, roles: Role[] | null): Promise<{ workspaceId: string; session: SessionRow }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, roles);
  const sessionId = req.params['sessionId'] ?? '';
  const res = await ctx.db.query('SELECT * FROM run_sessions WHERE id = $1 AND workspace_id = $2', [sessionId, workspaceId]);
  const row = res.rows[0];
  if (!row) throw errors.notFound();
  return {
    workspaceId,
    session: {
      id: row.id,
      name: row.name,
      status: row.status,
      hold_reason: row.hold_reason,
      ratio: Number(row.ratio),
      revision: Number(row.revision),
      control_revision: Number(row.control_revision),
      session_version: Number(row.session_version),
      tick: Number(row.tick),
      fast_clock_seconds: Number(row.fast_clock_seconds),
      layout_version_id: row.layout_version_id,
      layout_version_number: Number(row.layout_version_number),
      timetable_version: Number(row.timetable_version),
      state: row.state as unknown as SessionState,
    },
  };
}

async function sessionContent(ctx: RouteContext, layoutVersionId: string): Promise<LayoutContent> {
  const res = await ctx.db.query('SELECT content FROM layout_versions WHERE id = $1', [layoutVersionId]);
  const row = res.rows[0];
  if (!row) throw errors.notFound();
  return row.content as LayoutContent;
}

async function getSessions(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, null);
  const res = await ctx.db.query(
    'SELECT id, name, status, tick, layout_version_number FROM run_sessions WHERE workspace_id = $1 ORDER BY id',
    [workspaceId],
  );
  return {
    status: 200,
    body: { sessions: res.rows.map((r: { id: string; name: string; status: string; tick: string; layout_version_number: number }) => ({ id: r.id, name: r.name, status: r.status, tick: Number(r.tick), layout_version_number: r.layout_version_number })) },
  };
}

async function postSession(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { name?: string; layout_version_id?: string; ratio?: number };
  if (typeof body?.name !== 'string' || body.name.trim() === '' || typeof body.layout_version_id !== 'string') throw errors.invalidFields();
  const ratio = body.ratio ?? 6;
  if (!Number.isInteger(ratio) || ratio < 1 || ratio > 12) throw errors.invalidFields();
  const sessionName = body.name;
  const layoutVersionId = body.layout_version_id;
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const version = await client.query('SELECT id, layout_id, number, state, content, timetable_version FROM layout_versions WHERE id = $1', [layoutVersionId]);
      const v = version.rows[0];
      if (!v) throw errors.notFound();
      if (v.state !== 'Published') throw errors.versionNotPublished();
      const belongs = await client.query('SELECT workspace_id FROM layouts WHERE id = $1', [v.layout_id]);
      if (belongs.rows[0]?.workspace_id !== workspaceId) throw errors.notFound();
      const content = v.content as LayoutContent;
      const id = `ses-${randomId()}`;
      const state = buildSessionState(id, v.id, v.number, v.timetable_version, content, ratio);
      await client.query(
        `INSERT INTO run_sessions (id, workspace_id, name, status, hold_reason, ratio, revision, control_revision, session_version, tick, fast_clock_seconds, layout_version_id, layout_version_number, timetable_version, state)
         VALUES ($1,$2,$3,'Scheduled',NULL,$4,0,0,1,0,0,$5,$6,$7,$8)`,
        [id, workspaceId, sessionName.trim(), ratio, v.id, v.number, v.timetable_version, JSON.stringify(state)],
      );
      await client.query('COMMIT');
      const fresh = await ctx.db.query('SELECT * FROM run_sessions WHERE id = $1', [id]);
      return { status: 201, body: snapshotOf(fresh.rows[0] as never) };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function getSessionRoute(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { session } = await loadSession(ctx, req, null);
  return { status: 200, body: snapshotOf(session) };
}

/** Session commands: the state machine in one place. */
function transitionFor(status: string, command: 'start' | 'hold' | 'resume' | 'end', holdReason: string | null): { to: string; reason: string | null } | null {
  if (command === 'start' && status === 'Scheduled') return { to: 'Running', reason: null };
  if (command === 'hold' && status === 'Running') return { to: 'Held', reason: 'operator' };
  if (command === 'resume' && status === 'Held' && holdReason === 'operator') return { to: 'Running', reason: null };
  if (command === 'resume' && status === 'Interrupted') return { to: 'Running', reason: null };
  if (command === 'end' && ['Running', 'Held', 'Interrupted'].includes(status)) return { to: 'Ended', reason: null };
  return null;
}

async function sessionCommand(ctx: RouteContext, req: RequestContext, command: 'start' | 'hold' | 'resume' | 'end'): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const sessionId = req.params['sessionId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT * FROM run_sessions WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [sessionId, workspaceId]);
      const row = fresh.rows[0];
      if (!row) throw errors.notFound();
      if (body.revision !== Number(row.control_revision)) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const transition = transitionFor(row.status, command, row.hold_reason);
      if (!transition) {
        await client.query('COMMIT');
        throw errors.sessionTransition(row.status);
      }
      if (command === 'start' || command === 'resume') {
        await client.query(`UPDATE run_sessions SET status = $2, hold_reason = NULL, control_revision = control_revision + 1, revision = revision + 1, last_tick_at = $3 WHERE id = $1`, [sessionId, transition.to, command === 'resume' ? new Date(Date.now() - 1000) : null]);
      } else {
        await client.query(`UPDATE run_sessions SET status = $2, hold_reason = $3, control_revision = control_revision + 1, revision = revision + 1 WHERE id = $1`, [sessionId, transition.to, transition.reason]);
      }
      const revision = Number(row.revision) + 1;
      const snapshotRow = { ...row, status: transition.to, hold_reason: transition.reason, revision, control_revision: Number(row.control_revision) + 1 };
      const snapshot = snapshotOf(snapshotRow as never);
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'session.status',$3)`,
        [`gandyboard:session:${sessionId}:events`, revision, { seq: revision, type: 'session.status', session: snapshot, detail: { to: transition.to, reason: transition.reason } }],
      );
      await client.query('COMMIT');
      return { status: 200, body: snapshot };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postSessionStart(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  return sessionCommand(ctx, req, 'start');
}
async function postSessionHold(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  return sessionCommand(ctx, req, 'hold');
}
async function postSessionResume(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  return sessionCommand(ctx, req, 'resume');
}
async function postSessionEnd(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  return sessionCommand(ctx, req, 'end');
}

async function postTrain(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as {
    revision?: number; number?: string; name?: string; length_mm?: number;
    speed_mph?: number; direction?: string; start_block_id?: string;
  };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  if (typeof body.number !== 'string' || body.number.trim() === '') throw errors.invalidFields();
  if (typeof body.name !== 'string') throw errors.invalidFields();
  if (typeof body.length_mm !== 'number' || body.length_mm < 300 || body.length_mm > 2400) throw errors.invalidFields();
  if (typeof body.speed_mph !== 'number' || !Number.isInteger(body.speed_mph) || body.speed_mph < 5 || body.speed_mph > 60) throw errors.invalidFields();
  if (body.direction !== 'east' && body.direction !== 'west') throw errors.invalidFields();
  if (typeof body.start_block_id !== 'string') throw errors.invalidFields();
  const { number: trainNumber, name: trainName, length_mm, speed_mph, direction, start_block_id: startBlockId } = body;
  const trainDirection = direction as 'east' | 'west';
  const sessionId = req.params['sessionId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT * FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const row = fresh.rows[0];
      if (!row || row.workspace_id !== workspaceId) throw errors.notFound();
      if (body.revision !== Number(row.session_version)) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      if (!['Scheduled', 'Running', 'Held'].includes(row.status)) {
        await client.query('COMMIT');
        throw errors.sessionTransition(row.status);
      }
      const state = row.state as unknown as SessionState;
      const startBlock = state.blocks.find((b) => b.id === body.start_block_id);
      if (!startBlock) throw errors.notFound();
      if (state.trains.find((t) => t.number === body.number)) {
        await client.query('COMMIT');
        throw errors.invalidFields({ message: 'That train number is already in this session.' });
      }
      if (startBlock.state !== 'free') {
        await client.query('COMMIT');
        throw errors.blockInUse(startBlock.name);
      }
      const train = {
        id: `t-${randomId()}`,
        number: trainNumber,
        name: trainName,
        direction: trainDirection,
        speed_mph,
        length_mm,
        start_block_id: startBlockId,
        start_head_offset_mm: startBlock.length_mm,
        head_block_id: startBlockId,
        head_offset_mm: startBlock.length_mm,
        trail_block_ids: [startBlockId],
        occupied_block_ids: [startBlockId],
        distance_run_mm: 0,
        carry: 0,
        authority_id: null,
        revision: 1,
      };
      state.trains.push(train);
      deriveOccupancy(state);
      recount(state);
      const sessionVersion = Number(row.session_version) + 1;
      const revision = Number(row.revision) + 1;
      await client.query(
        `UPDATE run_sessions SET state = $2, session_version = $3, revision = $4 WHERE id = $1`,
        [sessionId, JSON.stringify(state), sessionVersion, revision],
      );
      // Ready packets become Superseded.
      await client.query(`UPDATE crew_packets SET state = 'Superseded' WHERE session_id = $1 AND state = 'Ready'`, [sessionId]);
      const snapshotRow = { ...row, state, session_version: sessionVersion, revision };
      const snapshot = snapshotOf(snapshotRow as never);
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'session.version',$3)`,
        [`gandyboard:session:${sessionId}:events`, revision, { seq: revision, type: 'session.version', session: snapshot, detail: { session_version: sessionVersion, train } }],
      );
      await client.query('COMMIT');
      return { status: 201, body: snapshot };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postRoutePreview(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId, session } = await loadSession(ctx, req, null);
  const body = req.body as { destination_block_id?: string; via_block_id?: string | null };
  if (typeof body?.destination_block_id !== 'string') throw errors.invalidFields();
  const trainId = req.params['trainId'] ?? '';
  const content = await sessionContent(ctx, session.layout_version_id);
  const route = findRoute(session.state, content, trainId, body.destination_block_id, body.via_block_id ?? null);
  if (route.reason === 'no_route') throw errors.noRoute(blockName(session.state, body.destination_block_id));
  if (route.blockIds && route.blockIds.length > 8) throw errors.routeTooLong();
  const limitBlockId = route.blockIds?.[route.blockIds.length - 1] ?? body.destination_block_id;
  return {
    status: 200,
    body: {
      route_block_ids: route.blockIds,
      limit_block_id: limitBlockId,
      clear: route.reason === 'ok',
      conflict_block_id: route.conflictBlockId,
      other_train_number: otherNumber(session.state, route.otherTrainId),
    },
  };
}

function blockName(state: SessionState, blockId: string): string {
  return state.blocks.find((b) => b.id === blockId)?.name ?? blockId;
}

function otherNumber(state: SessionState, trainId: string | null): string | null {
  if (!trainId) return null;
  return state.trains.find((t) => t.id === trainId)?.number ?? null;
}

async function postAuthority(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { revision?: number; destination_block_id?: string; via_block_id?: string | null; time_limit_fast_seconds?: number };
  if (typeof body?.revision !== 'number' || typeof body.destination_block_id !== 'string') throw errors.invalidFields();
  const sessionId = req.params['sessionId'] ?? '';
  const trainId = req.params['trainId'] ?? '';
  const timeLimit = body.time_limit_fast_seconds ?? 3600;
  if (!Number.isInteger(timeLimit) || timeLimit < 6 || timeLimit > 43200) throw errors.invalidFields();
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT * FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const row = fresh.rows[0];
      if (!row || row.workspace_id !== workspaceId) throw errors.notFound();
      if (!['Running', 'Held'].includes(row.status)) {
        await client.query('COMMIT');
        throw errors.sessionNotActive();
      }
      const state = row.state as unknown as SessionState;
      const train = state.trains.find((t) => t.id === trainId);
      if (!train) throw errors.notFound();
      if (body.revision !== train.revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      if (train.authority_id) {
        const active = state.authorities.find((a) => a.id === train.authority_id && a.state === 'Granted');
        if (active) {
          await client.query('COMMIT');
          throw errors.authorityActive(train.number);
        }
      }
      const openDeadlock = state.deadlocks.find((d) => d.state === 'Open' && d.member_train_ids.includes(trainId));
      if (openDeadlock) {
        await client.query('COMMIT');
        throw errors.deadlockOpen(openDeadlock.train_numbers);
      }
      const content = await client.query('SELECT content FROM layout_versions WHERE id = $1', [row.layout_version_id]);
      const layoutContent = content.rows[0]?.content as LayoutContent;
      const route = findRoute(state, layoutContent, trainId, body.destination_block_id!, body.via_block_id ?? null);
      if (route.reason === 'no_route') {
        await client.query('COMMIT');
        throw errors.noRoute(blockName(state, body.destination_block_id!));
      }
      if (route.blockIds && route.blockIds.length > 8) {
        await client.query('COMMIT');
        throw errors.routeTooLong();
      }
      train.revision += 1;
      const revision = Number(row.revision) + 1;
      const fastClock = Number(row.fast_clock_seconds);
      if (route.reason === 'conflict' && route.blockIds) {
        // Refusal: commit a Refused authority and an open conflict.
        const conflictBlockId = route.conflictBlockId ?? body.destination_block_id!;
        const authority: Authority = {
          id: `au-${randomId()}`,
          train_id: trainId,
          state: 'Refused',
          block_ids: [],
          remaining_block_ids: [],
          limit_block_id: body.destination_block_id!,
          destination_block_id: body.destination_block_id!,
          via_block_id: body.via_block_id ?? null,
          expires_fast_seconds: fastClock,
          ended_reason: null,
          revision: 1,
        };
        state.authorities.push(authority);
        const conflict: Conflict = {
          id: `cf-${randomId()}`,
          state: 'Open',
          train_id: trainId,
          other_train_id: route.otherTrainId,
          block_id: conflictBlockId,
          note: '',
          revision: 1,
        };
        state.conflicts.push(conflict);
        // Close the requester's earlier open conflict (a new decision supersedes it).
        for (const c of state.conflicts) {
          if (c.id !== conflict.id && c.train_id === trainId && c.state === 'Open') c.state = 'Closed';
        }
        recount(state);
        await client.query('UPDATE run_sessions SET state = $2, revision = $3 WHERE id = $1', [sessionId, JSON.stringify(state), revision]);
        const snapshotRow = { ...row, state, revision };
        const snapshot = snapshotOf(snapshotRow as never);
        await client.query(
          `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'authority.refused',$3)`,
          [`gandyboard:session:${sessionId}:events`, revision, { seq: revision, type: 'authority.refused', session: snapshot, detail: { authority, conflict } }],
        );
        await client.query('COMMIT');
        throw errors.routeConflict(otherNumber(state, route.otherTrainId), blockName(state, conflictBlockId), authority, conflict, route.blockIds);
      }
      const blockIds = route.blockIds ?? [];
      if (blockIds.length === 0) {
        await client.query('COMMIT');
        throw errors.noRoute(blockName(state, body.destination_block_id!));
      }
      const limitBlockId = blockIds[blockIds.length - 1] ?? body.destination_block_id!;
      const authority: Authority = {
        id: `au-${randomId()}`,
        train_id: trainId,
        state: 'Granted',
        block_ids: blockIds,
        remaining_block_ids: blockIds,
        limit_block_id: limitBlockId,
        destination_block_id: body.destination_block_id!,
        via_block_id: body.via_block_id ?? null,
        expires_fast_seconds: fastClock + timeLimit,
        ended_reason: null,
        revision: 1,
      };
      state.authorities.push(authority);
      train.authority_id = authority.id;
      // Lock each turnout on the route and set positions.
      for (const turnout of state.turnouts) {
        if (layoutContent.turnouts.some((t) => t.id === turnout.id && (t.normal_block_id === limitBlockId || t.reverse_block_id === limitBlockId || t.stem_block_id === limitBlockId))) {
          turnout.locked_by_authority_id = authority.id;
        }
      }
      // Close the requester's earlier open conflicts (granted).
      for (const c of state.conflicts) {
        if (c.train_id === trainId && c.state === 'Open') c.state = 'Closed';
      }
      deriveOccupancy(state);
      recount(state);
      await client.query('UPDATE run_sessions SET state = $2, revision = $3 WHERE id = $1', [sessionId, JSON.stringify(state), revision]);
      const snapshotRow = { ...row, state, revision };
      const snapshot = snapshotOf(snapshotRow as never);
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'authority.granted',$3)`,
        [`gandyboard:session:${sessionId}:events`, revision, { seq: revision, type: 'authority.granted', session: snapshot, detail: { authority } }],
      );
      await client.query('COMMIT');
      return { status: 201, body: { authority, session: snapshot } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postCancelAuthority(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const sessionId = req.params['sessionId'] ?? '';
  const authorityId = req.params['authorityId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT * FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const row = fresh.rows[0];
      if (!row || row.workspace_id !== workspaceId) throw errors.notFound();
      if (!['Running', 'Held'].includes(row.status)) {
        await client.query('COMMIT');
        throw errors.sessionNotActive();
      }
      const state = row.state as unknown as SessionState;
      const authority = state.authorities.find((a) => a.id === authorityId);
      if (!authority) throw errors.notFound();
      if (body.revision !== authority.revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      if (authority.state !== 'Granted') {
        await client.query('COMMIT');
        throw errors.authorityEnded();
      }
      const train = state.trains.find((t) => t.id === authority.train_id);
      if (train) {
        const headBlock = state.blocks.find((b) => b.id === train.head_block_id);
        if (headBlock?.kind === 'approach') {
          await client.query('COMMIT');
          throw errors.approachLocked(train.number);
        }
      }
      authority.state = 'Released';
      authority.ended_reason = 'cancelled';
      authority.revision += 1;
      if (train) {
        train.authority_id = null;
        train.revision += 1;
      }
      for (const t of state.turnouts) {
        if (t.locked_by_authority_id === authority.id) t.locked_by_authority_id = null;
      }
      deriveOccupancy(state);
      recount(state);
      const revision = Number(row.revision) + 1;
      await client.query('UPDATE run_sessions SET state = $2, revision = $3 WHERE id = $1', [sessionId, JSON.stringify(state), revision]);
      const snapshotRow = { ...row, state, revision };
      const snapshot = snapshotOf(snapshotRow as never);
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'authority.released',$3)`,
        [`gandyboard:session:${sessionId}:events`, revision, { seq: revision, type: 'authority.released', session: snapshot, detail: { authority } }],
      );
      await client.query('COMMIT');
      return { status: 200, body: { authority, session: snapshot } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

/** Back to loop and Recall: dispatcher moves that revoke, close conflicts and clear deadlocks. */
async function moveTrain(ctx: RouteContext, req: RequestContext, kind: 'back-to-loop' | 'recall'): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const sessionId = req.params['sessionId'] ?? '';
  const trainId = req.params['trainId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT * FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const row = fresh.rows[0];
      if (!row || row.workspace_id !== workspaceId) throw errors.notFound();
      if (!['Running', 'Held'].includes(row.status)) {
        await client.query('COMMIT');
        throw errors.sessionNotActive();
      }
      const state = row.state as unknown as SessionState;
      const train = state.trains.find((t) => t.id === trainId);
      if (!train) throw errors.notFound();
      if (body.revision !== train.revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const contentRes = await client.query('SELECT content FROM layout_versions WHERE id = $1', [row.layout_version_id]);
      const content = contentRes.rows[0]?.content as LayoutContent;

      let destinationBlockId: string | null = null;
      if (kind === 'back-to-loop') {
        // Free loop with the fewest blocks between it and the head, ties to the lower number.
        const graph = blockGraph(content);
        const loops = state.blocks.filter((b) => b.kind === 'loop' && b.state === 'free');
        let best: { id: string; distance: number } | null = null;
        for (const loop of loops) {
          const distance = graphDistance(graph, state, train.head_block_id, loop.id, train.direction);
          if (distance === null) continue;
          if (!best || distance < best.distance) best = { id: loop.id, distance };
        }
        if (!best) {
          await client.query('COMMIT');
          throw errors.noFreeLoop(train.number);
        }
        destinationBlockId = best.id;
      } else {
        const startBlock = state.blocks.find((b) => b.id === train.start_block_id);
        if (!startBlock) throw errors.notFound();
        if (startBlock.state !== 'free') {
          await client.query('COMMIT');
          throw errors.recallBlocked(startBlock.name);
        }
        destinationBlockId = startBlock.id;
      }
      const destination = state.blocks.find((b) => b.id === destinationBlockId);
      if (!destination) throw errors.notFound();
      train.head_block_id = destination.id;
      train.head_offset_mm = destination.length_mm;
      train.trail_block_ids = [destination.id];
      train.carry = 0;
      train.revision += 1;

      const revokedAuthority = state.authorities.find((a) => a.id === train.authority_id && a.state === 'Granted') ?? null;
      if (revokedAuthority) {
        revokedAuthority.state = 'Revoked';
        revokedAuthority.ended_reason = 'moved';
        revokedAuthority.revision += 1;
      }
      train.authority_id = null;
      const closedConflicts: Conflict[] = [];
      for (const c of state.conflicts) {
        if (c.state === 'Open' && (c.train_id === trainId || c.other_train_id === trainId)) {
          c.state = 'Closed';
          c.revision += 1;
          closedConflicts.push(c);
        }
      }
      const clearedDeadlocks = [];
      for (const d of state.deadlocks) {
        if (d.state === 'Open' && d.member_train_ids.includes(trainId)) {
          d.state = 'Cleared';
          clearedDeadlocks.push(d);
        }
      }
      deriveOccupancy(state);
      recount(state);
      const revision = Number(row.revision) + 1;
      await client.query('UPDATE run_sessions SET state = $2, revision = $3 WHERE id = $1', [sessionId, JSON.stringify(state), revision]);
      const snapshotRow = { ...row, state, revision };
      const snapshot = snapshotOf(snapshotRow as never);
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'train.moved',$3)`,
        [`gandyboard:session:${sessionId}:events`, revision, {
          seq: revision,
          type: 'train.moved',
          session: snapshot,
          detail: { train_id: trainId, to_block_id: destination.id, revoked_authority: revokedAuthority, closed_conflicts: closedConflicts, cleared_deadlocks: clearedDeadlocks },
        }],
      );
      await client.query('COMMIT');
      return { status: 200, body: snapshot };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

function graphDistance(graph: ReturnType<typeof blockGraph>, state: SessionState, from: string, to: string, dir: 'east' | 'west'): number | null {
  const visited = new Set<string>([from]);
  const queue: { id: string; hops: number }[] = [{ id: from, hops: 0 }];
  while (queue.length > 0) {
    queue.sort((a, b) => a.hops - b.hops || blockNumberIn(state, a.id) - blockNumberIn(state, b.id));
    const cur = queue.shift();
    if (!cur) break;
    if (cur.id === to) return cur.hops;
    for (const next of (graph.get(cur.id)?.[dir] ?? [])) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ id: next, hops: cur.hops + 1 });
    }
  }
  return null;
}

function blockNumberIn(state: SessionState, blockId: string): number {
  return state.blocks.find((b) => b.id === blockId)?.number ?? 0;
}

async function postBackToLoop(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  return moveTrain(ctx, req, 'back-to-loop');
}

async function postRecall(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  return moveTrain(ctx, req, 'recall');
}

async function patchConflict(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { revision?: number; note?: string };
  if (typeof body?.revision !== 'number' || typeof body.note !== 'string') throw errors.invalidFields();
  const note = body.note;
  const sessionId = req.params['sessionId'] ?? '';
  const conflictId = req.params['conflictId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT * FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const row = fresh.rows[0];
      if (!row || row.workspace_id !== workspaceId) throw errors.notFound();
      const state = row.state as unknown as SessionState;
      const conflict = state.conflicts.find((c) => c.id === conflictId);
      if (!conflict) throw errors.notFound();
      if (body.revision !== conflict.revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      conflict.note = note;
      conflict.revision += 1;
      const revision = Number(row.revision) + 1;
      await client.query('UPDATE run_sessions SET state = $2, revision = $3 WHERE id = $1', [sessionId, JSON.stringify(state), revision]);
      const snapshotRow = { ...row, state, revision };
      const snapshot = snapshotOf(snapshotRow as never);
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'conflict.changed',$3)`,
        [`gandyboard:session:${sessionId}:events`, revision, { seq: revision, type: 'conflict.changed', session: snapshot, detail: { conflict } }],
      );
      await client.query('COMMIT');
      return { status: 200, body: { conflict } };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postWithdraw(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const sessionId = req.params['sessionId'] ?? '';
  const conflictId = req.params['conflictId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT * FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const row = fresh.rows[0];
      if (!row || row.workspace_id !== workspaceId) throw errors.notFound();
      if (!['Running', 'Held'].includes(row.status)) {
        await client.query('COMMIT');
        throw errors.sessionNotActive();
      }
      const state = row.state as unknown as SessionState;
      const conflict = state.conflicts.find((c) => c.id === conflictId);
      if (!conflict) throw errors.notFound();
      if (body.revision !== conflict.revision) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const train = state.trains.find((t) => t.id === conflict.train_id);
      if (train) {
        const openDeadlock = state.deadlocks.find((d) => d.state === 'Open' && d.member_train_ids.includes(train.id));
        if (openDeadlock) {
          await client.query('COMMIT');
          throw errors.deadlockOpen(openDeadlock.train_numbers);
        }
      }
      conflict.state = 'Closed';
      conflict.revision += 1;
      recount(state);
      const revision = Number(row.revision) + 1;
      await client.query('UPDATE run_sessions SET state = $2, revision = $3 WHERE id = $1', [sessionId, JSON.stringify(state), revision]);
      const snapshotRow = { ...row, state, revision };
      const snapshot = snapshotOf(snapshotRow as never);
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'conflict.closed',$3)`,
        [`gandyboard:session:${sessionId}:events`, revision, { seq: revision, type: 'conflict.closed', session: snapshot, detail: { conflict } }],
      );
      await client.query('COMMIT');
      return { status: 200, body: snapshot };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postBlockService(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { revision?: number; out_of_service?: boolean };
  if (typeof body?.revision !== 'number' || typeof body.out_of_service !== 'boolean') throw errors.invalidFields();
  const sessionId = req.params['sessionId'] ?? '';
  const blockId = req.params['blockId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT * FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const row = fresh.rows[0];
      if (!row || row.workspace_id !== workspaceId) throw errors.notFound();
      if (!['Running', 'Held'].includes(row.status)) {
        await client.query('COMMIT');
        throw errors.sessionNotActive();
      }
      if (body.revision !== Number(row.control_revision)) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const state = row.state as unknown as SessionState;
      const block = state.blocks.find((b) => b.id === blockId);
      if (!block) throw errors.notFound();
      if (body.out_of_service && block.state !== 'free') {
        await client.query('COMMIT');
        throw errors.blockInUse(block.name);
      }
      block.state = body.out_of_service ? 'out_of_service' : 'free';
      deriveOccupancy(state);
      recount(state);
      const revision = Number(row.revision) + 1;
      await client.query(
        'UPDATE run_sessions SET state = $2, revision = $3, control_revision = control_revision + 1 WHERE id = $1',
        [sessionId, JSON.stringify(state), revision],
      );
      const snapshotRow = { ...row, state, revision, control_revision: Number(row.control_revision) + 1 };
      const snapshot = snapshotOf(snapshotRow as never);
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'block.changed',$3)`,
        [`gandyboard:session:${sessionId}:events`, revision, { seq: revision, type: 'block.changed', session: snapshot, detail: { block_id: blockId, state: block.state } }],
      );
      await client.query('COMMIT');
      return { status: 200, body: snapshot };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function postTurnoutThrow(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { revision?: number; position?: string };
  if (typeof body?.revision !== 'number' || (body.position !== 'normal' && body.position !== 'reverse')) throw errors.invalidFields();
  const sessionId = req.params['sessionId'] ?? '';
  const turnoutId = req.params['turnoutId'] ?? '';
  return withKey(ctx, req, workspaceId, async () => {
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query('SELECT * FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const row = fresh.rows[0];
      if (!row || row.workspace_id !== workspaceId) throw errors.notFound();
      if (!['Running', 'Held'].includes(row.status)) {
        await client.query('COMMIT');
        throw errors.sessionNotActive();
      }
      if (body.revision !== Number(row.control_revision)) {
        await client.query('COMMIT');
        throw errors.staleRevision();
      }
      const state = row.state as unknown as SessionState;
      const turnout = state.turnouts.find((t) => t.id === turnoutId);
      if (!turnout) throw errors.notFound();
      if (turnout.locked_by_authority_id) {
        const authority = state.authorities.find((a) => a.id === turnout.locked_by_authority_id);
        const train = authority ? state.trains.find((t) => t.id === authority.train_id) : undefined;
        await client.query('COMMIT');
        throw errors.turnoutLocked(turnoutId, train?.number ?? '?');
      }
      turnout.position = body.position as 'normal' | 'reverse';
      const revision = Number(row.revision) + 1;
      await client.query(
        'UPDATE run_sessions SET state = $2, revision = $3, control_revision = control_revision + 1 WHERE id = $1',
        [sessionId, JSON.stringify(state), revision],
      );
      const snapshotRow = { ...row, state, revision, control_revision: Number(row.control_revision) + 1 };
      const snapshot = snapshotOf(snapshotRow as never);
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'turnout.changed',$3)`,
        [`gandyboard:session:${sessionId}:events`, revision, { seq: revision, type: 'turnout.changed', session: snapshot, detail: { turnout } }],
      );
      await client.query('COMMIT');
      return { status: 200, body: snapshot };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}

async function getSessionBlocks(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { session } = await loadSession(ctx, req, null);
  const q = (req.query.get('q') ?? '').toLowerCase();
  let blocks = session.state.blocks.map((b) => ({ id: b.id, number: b.number, name: b.name, kind: b.kind }));
  if (q) {
    blocks = blocks.filter((b) => b.name.toLowerCase().includes(q) || String(b.number).includes(q));
  }
  return { status: 200, body: { blocks } };
}

// ---------- crew packets ----------

function packetRow(r: {
  id: string; state: string; session_version: string | number; content_hash: string | null;
  failure: string | null; issued_by: string; issued_at: Date; ready_at: Date | null; byte_length: number | null;
}): CrewPacket {
  return {
    id: r.id,
    state: r.state as CrewPacket['state'],
    session_version: Number(r.session_version),
    content_hash: r.content_hash,
    failure: r.failure as CrewPacket['failure'],
    issued_by: r.issued_by,
    issued_at: new Date(r.issued_at).toISOString(),
    ready_at: r.ready_at ? new Date(r.ready_at).toISOString() : null,
    byte_length: r.byte_length,
  };
}

async function getPackets(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { session } = await loadSession(ctx, req, null);
  const res = await ctx.db.query(
    `SELECT id, state, session_version, content_hash, failure, issued_by, issued_at, ready_at, byte_length
     FROM crew_packets WHERE session_id = $1 ORDER BY issued_at`,
    [session.id],
  );
  return { status: 200, body: { packets: res.rows.map(packetRow) } };
}

async function packetContent(ctx: RouteContext, session: SessionRow): Promise<{ content: Record<string, unknown>; contentHash: string }> {
  const contentRes = await ctx.db.query('SELECT content FROM layout_versions WHERE id = $1', [session.layout_version_id]);
  const layoutContent = contentRes.rows[0]?.content as LayoutContent;
  const timetable = layoutContent.timetable;
  const stationsById = new Map(layoutContent.stations.map((s) => [s.id, s]));
  const trainsById = new Map(layoutContent.trains.map((t) => [t.id, t]));
  const rows = timetable.entries.map((entry) => ({
    entry_id: entry.id,
    train_number: trainsById.get(entry.train_id)?.number ?? entry.train_id,
    station_name: stationsById.get(entry.station_id)?.name ?? entry.station_id,
    depart: fastClockLabel(entry.depart_fast_seconds),
  }));
  const orders = session.state.trains.map((t) => {
    const entries = timetable.entries.filter((e) => e.train_id === t.id);
    const first = entries[0];
    const last = entries[entries.length - 1];
    return {
      number: t.number,
      name: t.name,
      direction: t.direction,
      from: first ? stationsById.get(first.station_id)?.name ?? '' : '',
      to: last ? stationsById.get(last.station_id)?.name ?? '' : '',
      depart: first ? fastClockLabel(first.depart_fast_seconds) : '00:00:00',
    };
  });
  const blockTable = session.state.blocks.map((b) => ({ number: b.number, name: b.name, kind: b.kind, length_mm: b.length_mm }));
  const diagram = session.state.blocks.map((b) => ({ number: b.number, name: b.name, neighbours: [] }));
  const content = {
    session_name: session.name,
    timetable: rows,
    train_orders: orders,
    block_table: blockTable,
    track_diagram: diagram,
  };
  const contentHash = canonicalHash({ session_version: session.session_version, content });
  return { content, contentHash };
}

async function getPacketPreview(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { session } = await loadSession(ctx, req, null);
  const { content, contentHash } = await packetContent(ctx, session);
  return { status: 200, body: { session_version: session.session_version, content, content_hash: contentHash } };
}

async function postPacket(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { workspaceId } = await resolveWorkspace(ctx, req, ['founder', 'manager', 'operator']);
  const user = requireSession(req);
  const body = req.body as { revision?: number };
  if (typeof body?.revision !== 'number') throw errors.invalidFields();
  const sessionVersion = body.revision;
  const sessionId = req.params['sessionId'] ?? '';
  const stored = await ctx.db.query('SELECT * FROM run_sessions WHERE id = $1 AND workspace_id = $2', [sessionId, workspaceId]);
  const row = stored.rows[0];
  if (!row) throw errors.notFound();
  if (body.revision !== Number(row.session_version)) throw errors.staleRevision();
  return withKey(ctx, req, workspaceId, async () => {
    // Insert the packet row as Queued outside a session transaction; rendering happens after.
    const id = `pk-${randomId()}`;
    await ctx.db.query(
      `INSERT INTO crew_packets (id, session_id, state, session_version, issued_by, issued_at)
       VALUES ($1,$2,'Queued',$3,$4,now())`,
      [id, sessionId, sessionVersion, user.id],
    );
    const packet = await ctx.db.query(
      `SELECT id, state, session_version, content_hash, failure, issued_by, issued_at, ready_at, byte_length FROM crew_packets WHERE id = $1`,
      [id],
    );
    // Render asynchronously: the browser watches the state through events.
    void renderPacket(ctx, id, sessionId, sessionVersion);
    return { status: 202, body: { packet: packetRow(packet.rows[0]) } };
  });
}

async function renderPacket(ctx: RouteContext, packetId: string, sessionId: string, sessionVersion: number): Promise<void> {
  try {
    await ctx.db.query(`UPDATE crew_packets SET state = 'Rendering' WHERE id = $1`, [packetId]);
    await writePacketEvent(ctx, sessionId, packetId, 'Rendering');
    const sessionRes = await ctx.db.query('SELECT * FROM run_sessions WHERE id = $1', [sessionId]);
    const row = sessionRes.rows[0];
    if (!row) throw new Error('session missing');
    const session: SessionRow = {
      id: row.id, name: row.name, status: row.status, hold_reason: row.hold_reason,
      ratio: Number(row.ratio), revision: Number(row.revision), control_revision: Number(row.control_revision),
      session_version: Number(row.session_version), tick: Number(row.tick), fast_clock_seconds: Number(row.fast_clock_seconds),
      layout_version_id: row.layout_version_id, layout_version_number: Number(row.layout_version_number),
      timetable_version: Number(row.timetable_version), state: row.state as unknown as SessionState,
    };
    const { content, contentHash } = await packetContent(ctx, session);
    const gotenbergUp = await ctx.gotenberg.probe();
    if (!gotenbergUp) {
      await ctx.db.query(`UPDATE crew_packets SET state = 'Failed', failure = 'gotenberg_unreachable' WHERE id = $1`, [packetId]);
      await writePacketEvent(ctx, sessionId, packetId, 'Failed');
      return;
    }
    const html = buildPacketHtml(session, sessionVersion, contentHash, content);
    const bytes = await ctx.gotenberg.renderPdf(html);
    const valkeyUp = await ctx.valkey.probe();
    if (!valkeyUp) {
      await ctx.db.query(`UPDATE crew_packets SET state = 'Failed', failure = 'valkey_unreachable' WHERE id = $1`, [packetId]);
      await writePacketEvent(ctx, sessionId, packetId, 'Failed');
      return;
    }
    // Ready commits only after Gotenberg returned bytes and Valkey answered, in one transaction.
    const client = await ctx.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT revision FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const seqRes = await client.query(
        'SELECT coalesce(max(seq),0)+1 AS seq FROM event_outbox WHERE stream = $1',
        [`gandyboard:session:${sessionId}:events`],
      );
      const seq = Number(seqRes.rows[0]?.seq ?? 1);
      await client.query(
        `UPDATE crew_packets SET state = 'Ready', content_hash = $2, pdf_bytes = $3, byte_length = $4, ready_at = now()
         WHERE id = $1`,
        [packetId, contentHash, bytes, bytes.length],
      );
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'packet.changed',$3)`,
        [`gandyboard:session:${sessionId}:events`, seq, { packet_id: packetId, state: 'Ready' }],
      );
      await client.query('UPDATE run_sessions SET revision = $2 WHERE id = $1', [sessionId, seq]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('packet render failed', packetId, e);
    await ctx.db.query(`UPDATE crew_packets SET state = 'Failed', failure = 'gotenberg_unreachable' WHERE id = $1 AND state IN ('Queued','Rendering')`, [packetId])
      .catch(() => {});
    await writePacketEvent(ctx, sessionId, packetId, 'Failed').catch(() => {});
  }
}

async function writePacketEvent(ctx: RouteContext, sessionId: string, packetId: string, state: string): Promise<void> {
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    // Serialise seq allocation on the session row so commands and renders agree.
    await client.query('SELECT revision FROM run_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    const seqRes = await client.query(
      `SELECT coalesce(max(seq),0)+1 AS seq FROM event_outbox WHERE stream = $1`,
      [`gandyboard:session:${sessionId}:events`],
    );
    const seq = Number(seqRes.rows[0]?.seq ?? 1);
    await client.query(
      `INSERT INTO event_outbox (stream, seq, type, payload) VALUES ($1,$2,'packet.changed',$3)`,
      [`gandyboard:session:${sessionId}:events`, seq, { packet_id: packetId, state }],
    );
    // The session revision matches the stream seq it committed.
    await client.query('UPDATE run_sessions SET revision = $2 WHERE id = $1', [sessionId, seq]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function buildPacketHtml(session: SessionRow, sessionVersion: number, contentHash: string, content: Record<string, unknown>): string {
  const footer = `<div class="footer">Session version ${sessionVersion} | Content hash ${contentHash}</div>`;
  const timetableRows = (content.timetable as { entry_id: string; train_number: string; station_name: string; depart: string }[])
    .map((r) => `<tr><td>${escapeHtml(r.depart)}</td><td>${escapeHtml(r.train_number)}</td><td>${escapeHtml(r.station_name)}</td></tr>`).join('');
  const orders = (content.train_orders as { number: string; name: string; direction: string; from: string; to: string; depart: string }[])
    .map((o) => `<p>Train ${escapeHtml(o.number)} ${escapeHtml(o.name)}: run ${escapeHtml(o.direction)} from ${escapeHtml(o.from)} to ${escapeHtml(o.to)}, departing ${escapeHtml(o.depart)}.</p>`).join('');
  const blockRows = (content.block_table as { number: number; name: string; kind: string; length_mm: number }[])
    .map((b) => `<tr><td>${b.number}</td><td>${escapeHtml(b.name)}</td><td>${escapeHtml(b.kind)}</td><td>${b.length_mm} mm</td></tr>`).join('');
  const diagram = (content.track_diagram as { number: number; name: string }[])
    .map((b) => `<div class="diagram-block"><span class="num">${b.number}</span> ${escapeHtml(b.name)}</div>`).join('<div class="arrow">&#8594;</div>');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(session.name)} crew packet</title>
<style>
  body { font-family: sans-serif; margin: 24px; }
  h1, h2 { margin-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  td, th { border: 1px solid #333; padding: 4px 8px; text-align: left; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 10px; text-align: center; }
  .diagram { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .diagram-block { border: 2px solid #235; border-radius: 8px; padding: 6px 10px; }
  .num { font-weight: bold; }
  .arrow { font-size: 20px; }
</style></head><body>
<h1>${escapeHtml(session.name)} crew packet</h1>
${footer}
<h2>Timetable</h2>
<table><tr><th>Time</th><th>Train</th><th>Station</th></tr>${timetableRows}</table>
<h2>Train orders</h2>
${orders}
<h2>Block table</h2>
<table><tr><th>Number</th><th>Name</th><th>Kind</th><th>Length</th></tr>${blockRows}</table>
<h2>Track diagram</h2>
<div class="diagram">${diagram}</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

async function getPacket(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown }> {
  const { session } = await loadSession(ctx, req, null);
  const packetId = req.params['packetId'] ?? '';
  const res = await ctx.db.query(
    `SELECT id, state, session_version, content_hash, failure, issued_by, issued_at, ready_at, byte_length
     FROM crew_packets WHERE id = $1 AND session_id = $2`,
    [packetId, session.id],
  );
  const row = res.rows[0];
  if (!row) throw errors.notFound();
  return { status: 200, body: packetRow(row) };
}

async function getPacketPdf(ctx: RouteContext, req: RequestContext): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const { session } = await loadSession(ctx, req, null);
  const packetId = req.params['packetId'] ?? '';
  const res = await ctx.db.query(
    `SELECT pdf_bytes, byte_length FROM crew_packets WHERE id = $1 AND session_id = $2`,
    [packetId, session.id],
  );
  const row = res.rows[0];
  if (!row || !row.pdf_bytes) throw errors.packetNoPdf();
  const bytes: Buffer = row.pdf_bytes;
  return {
    status: 200,
    body: bytes,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
    },
  };
}


