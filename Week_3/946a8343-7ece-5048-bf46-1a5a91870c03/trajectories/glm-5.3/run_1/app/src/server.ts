import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { AppError } from './core/errors.js';
import { readEnv, newServerClock } from './core/config.js';
import { Db } from './db/db.js';
import { applySchema } from './db/schema-apply.js';
import { StorageService } from './services/storage.js';
import { liveLog } from './services/live.js';
import { hashPassword } from './services/passwords.js';
import { Ctx, json, errorBody, loadUser, requireBody } from './api/ctx.js';
import type { RequestCtx } from './api/ctx.js';
import { Router, readBody, checkRate, parseCookies, checkLoginRate } from './api/http.js';
import * as accounts from './api/accounts.js';
import * as groupsApi from './api/groups.js';
import * as repoApi from './api/repository.js';
import * as mrsApi from './api/mrs.js';
import * as mrActions from './api/mr-actions.js';
import * as pipelinesApi from './api/pipelines.js';
import * as envsApi from './api/environments.js';
import * as planningApi from './api/planning.js';
import * as issuesApi from './api/issues.js';
import * as boardsApi from './api/boards.js';
import * as miscApi from './api/misc.js';
import * as exportApi from './api/export.js';
import * as gradingApi from './api/grading.js';
import { seedDemo } from './seed/seed-demo.js';

const here = dirname(fileURLToPath(import.meta.url));
import { moveThreadsToIssue } from './api/mr-actions.js';

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx < 0 ? '.' : p.slice(0, idx);
}

const env = readEnv(process.env);
const clockState = { base: newServerClock(env.settings.grading) };
const clock = {
  nowMs: () => clockState.base.nowMs(),
  set: (ms: number) => {
    if (env.settings.grading) clockState.base = { nowMs: () => ms };
  },
  advance: (ms: number) => {
    if (env.settings.grading) {
      const cur = clockState.base.nowMs();
      clockState.base = { nowMs: () => cur + ms };
    }
  },
};
const db = new Db(env.databaseUrl);
const storage = new StorageService(env.s3, clock);
const ctx = new Ctx({ db, storage, settings: env.settings, s3: env.s3, clock });

const router = new Router();

// health
router.add('GET', '/api/health', async (rc) => {
  const pgOk = db.isReady() || (await db.query('SELECT 1').then(() => true).catch(() => false));
  if (!pgOk) return { status: 'starting' };
  const s3Ok = await storage.healthy().catch(() => false);
  return { status: s3Ok ? 'ok' : 'unavailable' };
}, { needsAuth: false, write: false });

// accounts
router.add('POST', '/api/users', accounts.createUser, { needsAuth: false, write: true });
router.add('POST', '/api/session', accounts.signIn, { needsAuth: false, write: true });
router.add('DELETE', '/api/session', accounts.signOut, { write: true });
router.add('GET', '/api/me', accounts.me, { write: false });
router.add('PATCH', '/api/me', accounts.updateMe, { write: true });

// grading routes
if (env.settings.grading) {
  router.add('POST', '/api/grading/seed', gradingApi.seed, { needsAuth: false, write: false, bodyKind: 'commit' });
  router.add('POST', '/api/grading/session', gradingApi.gradingSession, { needsAuth: false, write: false });
  router.add('POST', '/api/grading/clock', gradingApi.gradingClock, { needsAuth: false, write: false });
  router.add('POST', '/api/grading/commit', gradingApi.gradingCommit, { needsAuth: false, write: false, bodyKind: 'commit' });
  router.add('POST', '/api/grading/runner/step', gradingApi.gradingRunnerStep, { needsAuth: false, write: false });
  router.add('POST', '/api/grading/runner/settle', gradingApi.gradingRunnerSettle, { needsAuth: false, write: false });
  router.add('POST', '/api/grading/storage', gradingApi.gradingStorage, { needsAuth: false, write: false });
  router.add('POST', '/api/grading/sink/:name', gradingApi.gradingSinkPost, { needsAuth: false, write: false, bodyKind: 'import' });
  router.add('PUT', '/api/grading/sink/:name', gradingApi.gradingSinkPut, { needsAuth: false, write: false });
  router.add('GET', '/api/grading/sink/:name', gradingApi.gradingSinkGet, { needsAuth: false, write: false });
}

// groups
router.add('POST', '/api/groups', groupsApi.createGroup, { write: true });
router.add('GET', '/api/groups/:id', groupsApi.getGroup, { write: false });
router.add('PATCH', '/api/groups/:id', groupsApi.patchGroup, { write: true });
router.add('POST', '/api/groups/:id/members', groupsApi.addGroupMember, { write: true });
router.add('PATCH', '/api/groups/:id/members/:username', groupsApi.patchGroupMember, { write: true });
router.add('DELETE', '/api/groups/:id/members/:username', groupsApi.deleteGroupMember, { write: true });
router.add('POST', '/api/groups/:id/custom_roles', groupsApi.createCustomRole, { write: true });
router.add('POST', '/api/groups/:id/labels', groupsApi.createLabel, { write: true });
router.add('POST', '/api/groups/:id/audit', (async () => {
  throw new AppError(405, 'method_not_allowed', "This method isn't allowed here.");
}) as never, { write: false });
router.add('GET', '/api/groups/:id/audit', miscApi.groupAudit, { write: false });

// projects
router.add('POST', '/api/projects', groupsApi.createProject, { write: true });
router.add('GET', '/api/projects/:id', groupsApi.getProject, { write: false });
router.add('PATCH', '/api/projects/:id/settings', groupsApi.patchSettings, { write: true });
router.add('POST', '/api/projects/:id/members', groupsApi.addGroupMember, { write: true });
router.add('PATCH', '/api/projects/:id/members/:username', groupsApi.patchGroupMember, { write: true });
router.add('DELETE', '/api/projects/:id/members/:username', groupsApi.deleteGroupMember, { write: true });
router.add('POST', '/api/projects/:id/labels', groupsApi.createLabel, { write: true });
router.add('PUT', '/api/projects/:id/protected_branches/:pattern', groupsApi.putProtectedBranch, { write: true });
router.add('DELETE', '/api/projects/:id/protected_branches/:pattern', groupsApi.deleteProtectedBranch, { write: true });
router.add('PUT', '/api/projects/:id/protected_tags/:pattern', groupsApi.putProtectedTag, { write: true });
router.add('DELETE', '/api/projects/:id/protected_tags/:pattern', groupsApi.deleteProtectedTag, { write: true });
router.add('PUT', '/api/projects/:id/push_rules', groupsApi.putPushRules, { write: true });
router.add('POST', '/api/projects/:id/approval_rules', groupsApi.postApprovalRule, { write: true });
router.add('PATCH', '/api/projects/:id/approval_rules/:rule_id', groupsApi.patchApprovalRule, { write: true });
router.add('DELETE', '/api/projects/:id/approval_rules/:rule_id', groupsApi.deleteApprovalRule, { write: true });
router.add('PUT', '/api/projects/:id/variables/:key', groupsApi.putVariable, { write: true });
router.add('DELETE', '/api/projects/:id/variables/:key', groupsApi.deleteVariable, { write: true });
router.add('PUT', '/api/projects/:id/protected_environments/:name', groupsApi.putProtectedEnvironment, { write: true });
router.add('DELETE', '/api/projects/:id/protected_environments/:name', groupsApi.deleteProtectedEnvironment, { write: true });

// repository
router.add('GET', '/api/projects/:id/refs', repoApi.listRefs, { write: false });
router.add('POST', '/api/projects/:id/branches', repoApi.createBranch, { write: true });
router.add('DELETE', '/api/projects/:id/branches/:name', repoApi.deleteBranch, { write: true });
router.add('POST', '/api/projects/:id/tags', repoApi.createTag, { write: true });
router.add('GET', '/api/projects/:id/tree', repoApi.getTree, { write: false });
router.add('GET', '/api/projects/:id/files', repoApi.getFile, { write: false });
router.add('GET', '/api/projects/:id/commits', repoApi.listCommits, { write: false });
router.add('GET', '/api/projects/:id/commits/:commit', repoApi.getOneCommit, { write: false });
router.add('GET', '/api/projects/:id/blame', repoApi.getBlame, { write: false });
router.add('GET', '/api/projects/:id/compare', repoApi.compareRefs, { write: false });
router.add('POST', '/api/projects/:id/commits', repoApi.postCommit, { write: true, bodyKind: 'commit', idempotent: true });

// merge requests
router.add('GET', '/api/projects/:id/merge_requests', mrsApi.listMrThreads, { write: false });
router.add('POST', '/api/projects/:id/merge_requests', mrsApi.createMr, { write: true });
router.add('GET', '/api/projects/:id/merge_requests/:iid', mrsApi.getMrDetail, { write: false });
router.add('PATCH', '/api/projects/:id/merge_requests/:iid', mrsApi.patchMr, { write: true });
router.add('GET', '/api/projects/:id/merge_requests/:iid/threads', mrsApi.listMrThreads, { write: false });
router.add('POST', '/api/projects/:id/merge_requests/:iid/threads', mrsApi.createThread, { write: true });
router.add('PATCH', '/api/projects/:id/merge_requests/:iid/threads/:tid', mrsApi.resolveThread, { write: true });
router.add('POST', '/api/projects/:id/merge_requests/:iid/threads/move_to_issue', moveThreadsToIssue, { write: true });
router.add('GET', '/api/projects/:id/merge_requests/:iid/notes', mrsApi.listMrNotes, { write: false });
router.add('GET', '/api/projects/:id/merge_requests/:iid/diff', mrActions.getConflicts, { write: false });
router.add('GET', '/api/projects/:id/merge_requests/:iid/conflicts', mrActions.getConflicts, { write: false });
router.add('POST', '/api/projects/:id/merge_requests/:iid/conflicts', mrActions.resolveConflicts, { write: true });
router.add('POST', '/api/projects/:id/merge_requests/:iid/review', mrActions.submitReview, { write: true });
router.add('DELETE', '/api/projects/:id/merge_requests/:iid/review', mrActions.discardReview, { write: true });
router.add('POST', '/api/projects/:id/merge_requests/:iid/suggestions/apply', mrActions.applySuggestions, { write: true });
router.add('POST', '/api/projects/:id/merge_requests/:iid/approve', mrActions.approveMr, { write: true, idempotent: true });
router.add('DELETE', '/api/projects/:id/merge_requests/:iid/approve', mrActions.revokeApproval, { write: true });
router.add('POST', '/api/projects/:id/merge_requests/:iid/merge', mrActions.mergeMr, { write: true, idempotent: true });
router.add('POST', '/api/projects/:id/merge_requests/:iid/auto_merge', mrActions.setAutoMerge, { write: true });
router.add('DELETE', '/api/projects/:id/merge_requests/:iid/auto_merge', mrActions.cancelAutoMerge, { write: true });
router.add('POST', '/api/projects/:id/merge_requests/:iid/rebase', mrActions.rebaseMr, { write: true });
router.add('POST', '/api/projects/:id/merge_requests/:iid/train', mrActions.addMrToTrain, { write: true });
router.add('DELETE', '/api/projects/:id/merge_requests/:iid/train', mrActions.removeMrFromTrain, { write: true });
router.add('POST', '/api/projects/:id/merge_requests/:iid/train/merge_now', mrActions.mergeNow, { write: true });
router.add('GET', '/api/projects/:id/train', mrActions.getTrain, { write: false });
router.add('GET', '/api/projects/:id/train/:iid/tree', mrActions.getTrain, { write: false });
router.add('GET', '/api/projects/:id/merge_requests/:iid/reports', mrsApi.getMrDetail, { write: false });

// pipelines
router.add('POST', '/api/projects/:id/pipelines', pipelinesApi.createWebPipeline, { write: true });
router.add('GET', '/api/projects/:id/pipelines', pipelinesApi.listPipelines, { write: false });
router.add('POST', '/api/projects/:id/ci/lint', pipelinesApi.lintConfig, { write: false });
router.add('GET', '/api/pipelines/:pid', pipelinesApi.getPipeline, { write: false });
router.add('POST', '/api/pipelines/:pid/retry', pipelinesApi.retryPipeline, { write: true });
router.add('POST', '/api/pipelines/:pid/cancel', pipelinesApi.cancelPipeline, { write: true });
router.add('GET', '/api/jobs/:jid', pipelinesApi.getJob, { write: false });
router.add('GET', '/api/jobs/:jid/log', pipelinesApi.getJobLog, { write: false });
router.add('POST', '/api/jobs/:jid/play', pipelinesApi.playJob, { write: true });
router.add('POST', '/api/jobs/:jid/retry', pipelinesApi.retryJob, { write: true });
router.add('POST', '/api/jobs/:jid/cancel', pipelinesApi.cancelJob, { write: true });
router.add('GET', '/api/jobs/:jid/artifacts/:path', pipelinesApi.downloadArtifact, { write: false });
router.add('POST', '/api/jobs/:jid/artifacts/keep', pipelinesApi.keepArtifacts, { write: true });

// environments
router.add('GET', '/api/projects/:id/environments', envsApi.listEnvironments, { write: false });
router.add('GET', '/api/projects/:id/environments/:eid', envsApi.getEnvironment, { write: false });
router.add('POST', '/api/projects/:id/deployments/:deployment_id/approvals', envsApi.approveDeployment, { write: true, idempotent: true });
router.add('POST', '/api/environments/:eid/stop', envsApi.stopEnvironment, { write: true });
router.add('POST', '/api/environments/:eid/keep', envsApi.keepEnvironment, { write: true });
router.add('POST', '/api/environments/:eid/rollback', envsApi.rollbackDeployment, { write: true });
router.add('GET', '/api/projects/:id/metrics', envsApi.metrics, { write: false });

// planning
router.add('POST', '/api/projects/:id/issues', planningApi.createIssue, { write: true });
router.add('GET', '/api/projects/:id/issues/:iid', issuesApi.getIssue, { write: false });
router.add('PATCH', '/api/projects/:id/issues/:iid', issuesApi.patchIssue, { write: true });
router.add('POST', '/api/projects/:id/issues/:iid/notes', issuesApi.postIssueNote, { write: true });
router.add('GET', '/api/projects/:id/issues/:iid/notes', issuesApi.getIssueNotes, { write: false });
router.add('POST', '/api/projects/:id/issues/:iid/links', issuesApi.linkIssue, { write: true });
router.add('POST', '/api/projects/:id/milestones', boardsApi.createMilestone, { write: true });
router.add('GET', '/api/projects/:id/milestones/:mid/burndown', boardsApi.burndown, { write: false });
router.add('POST', '/api/groups/:id/epics', boardsApi.createEpic, { write: true });
router.add('PATCH', '/api/groups/:id/epics/:iid', boardsApi.patchEpic, { write: true });
router.add('GET', '/api/groups/:id/epics/:iid', boardsApi.getEpic, { write: false });
router.add('POST', '/api/groups/:id/epics/:iid/issues', boardsApi.addEpicIssue, { write: true });
router.add('POST', '/api/projects/:id/boards', boardsApi.createBoard, { write: true });
router.add('POST', '/api/groups/:id/boards', boardsApi.createBoard, { write: true });
router.add('GET', '/api/boards/:id', boardsApi.getBoard, { write: false });
router.add('POST', '/api/boards/:id/moves', boardsApi.moveCard, { write: true });

// wiki, webhooks, audit, search
router.add('GET', '/api/projects/:id/wiki/:slug', miscApi.getWikiPage, { write: false });
router.add('PUT', '/api/projects/:id/wiki/:slug', miscApi.putWikiPage, { write: true });
router.add('GET', '/api/projects/:id/wiki/:slug/versions', miscApi.wikiVersions, { write: false });
router.add('POST', '/api/projects/:id/wiki/:slug/restore', miscApi.restoreWikiVersion, { write: true });
router.add('POST', '/api/projects/:id/webhooks', miscApi.createWebhook, { write: true });
router.add('GET', '/api/projects/:id/webhooks/:webhook_id/deliveries', miscApi.listDeliveries, { write: false });
router.add('POST', '/api/deliveries/:id/redeliver', miscApi.redeliver, { write: true });
router.add('GET', '/api/projects/:id/audit', miscApi.projectAudit, { write: false });
router.add('POST', '/api/projects/:id/audit', (async () => {
  throw new AppError(405, 'method_not_allowed', "This method isn't allowed here.");
}) as never, { write: false });
router.add('GET', '/api/search', miscApi.search, { write: false });

// export and import
router.add('POST', '/api/projects/:id/exports', exportApi.startExport, { write: true });
router.add('GET', '/api/exports/:id', exportApi.getExport, { write: false });
router.add('GET', '/api/exports/:id/file', exportApi.downloadExport, { write: false });
router.add('POST', '/api/exports/:id/retry', exportApi.retryExport, { write: true });
router.add('POST', '/api/groups/:id/imports', exportApi.startImport, { needsAuth: true, write: false, bodyKind: 'import' });
router.add('POST', '/api/imports/:id/confirm', exportApi.confirmImport, { write: true });
router.add('GET', '/api/imports/:id', exportApi.getImport, { write: false });

// findings
router.add('PATCH', '/api/projects/:id/findings/:fid', (async (rc: RequestCtx) => {
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const id = Number(rc.params.id);
    const fid = Number(rc.params.fid);
    const { loadProject, requireMinRole } = await import('./api/common.js');
    const { hasPermission } = await import('./domain/access.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user!.id);
    const state = String(body.state ?? '');
    const reason = typeof body.reason === 'string' ? body.reason : null;
    const finding = (await client.query(`SELECT * FROM findings WHERE id = $1 AND mr_id IN (SELECT id FROM merge_requests WHERE project_id = $2)`, [fid, id])).rows[0];
    if (!finding) throw new AppError(404, 'not_found', 'Not found.');
    const legal: Record<string, string[]> = {
      detected: ['confirmed', 'dismissed', 'resolved'],
      confirmed: ['dismissed', 'resolved'],
      dismissed: ['detected'],
      resolved: [],
    };
    if (!(legal[finding.state] ?? []).includes(state)) {
      throw new AppError(409, 'illegal_transition', `A finding can't go from ${finding.state} to ${state}.`);
    }
    if (state === 'dismissed') {
      if (reason === null || reason.length < 10) {
        throw new AppError(422, 'validation', 'Give a reason of at least 10 characters.', { fields: { reason: 'Give a reason of at least 10 characters.' } });
      }
      if (!hasPermission(access, 'dismiss_finding')) {
        throw new AppError(403, 'forbidden', "You don't have permission to do that.");
      }
    }
    const before = { state: finding.state };
    await client.query(`UPDATE findings SET state = $2, reason = $3 WHERE id = $1`, [fid, state, reason]);
    const after = { state, reason };
    await (await import('./api/common.js')).writeAudit(client, {
      projectId: id, groupId: project.group_id, actor: rc.user!.username,
      action: 'finding.state', target: `${project.path}!${finding.mr_id}:${finding.report_id}`,
      before, after, at: rc.ctx.now(),
    });
    const seq = await rc.ctx.live(client, id, 'merge_request', { event: 'finding', finding: fid });
    await client.query('COMMIT');
    return { id: fid, report_id: finding.report_id, severity: finding.severity, title: finding.title, path: finding.path, line: finding.line, state, reason, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}) as never, { write: true });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(res: http.ServerResponse, path: string): boolean {
  const clean = path.split('?')[0];
  const file = join(here, 'public', clean.replace(/^\/+/, ''));
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  let body = readFileSync(file);
  if (file.endsWith('index.html')) {
    body = Buffer.from(body.toString('utf8').replace(/window\.SPUR_TOAST_MS = \d+/, `window.SPUR_TOAST_MS = ${env.settings.toastMs}`));
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'public, max-age=3600' });
  res.end(body);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  try {
    if (path.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    // built assets need no session
    if (path.startsWith('/assets/')) {
      if (serveStatic(res, path)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    // pages
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['spur_session'] ?? null;
    const user = await loadUser(ctx, token);
    const isAuthPage = path === '/sign-in' || path === '/sign-up';
    if (!user && !isAuthPage) {
      res.writeHead(302, { Location: '/sign-in' });
      res.end();
      return;
    }
    // SPA fallback serves index with the server-provided toast lifetime
    const index = join(here, 'public', 'index.html');
    if (existsSync(index)) {
      const body = Buffer.from(readFileSync(index).toString('utf8').replace(/window\.SPUR_TOAST_MS = \d+/, `window.SPUR_TOAST_MS = ${env.settings.toastMs}`));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    if (e instanceof AppError) {
      json(res, e.status, errorBody(e.code, e.message, e.details));
      return;
    }
    process.stderr.write(`server error: ${e instanceof Error ? e.stack : String(e)}\n`);
    json(res, 500, errorBody('internal', 'Something went wrong.'));
  }
});

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();
  const match = router.match(method, path);
  if (!match) {
    json(res, 404, errorBody('not_found', 'Not found.'));
    return;
  }
  if ('methodMismatch' in match) {
    const allowed = new Set<string>();
    for (const r of router['routes'] as Array<{ method: string; pattern: RegExp }>) {
      if (r.pattern.test(path)) allowed.add(r.method);
    }
    const body = JSON.stringify(errorBody('method_not_allowed', "This method isn't allowed here."));
    res.writeHead(405, { Allow: [...allowed].join(', '), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  const { route, params } = match;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['spur_session'] ?? null;
  const user = await loadUser(ctx, token);

  // body limits: precedence 413 first
  const maxBytes = route.bodyKind === 'commit' ? env.settings.commitBodyMaxBytes
    : route.bodyKind === 'import' ? env.settings.exportMaxBytes
    : env.settings.bodyMaxBytes;
  let raw: Buffer = Buffer.alloc(0);
  let bodyParseError = false;
  if (route.bodyKind !== 'none' && method !== 'GET' && method !== 'DELETE') {
    try {
      raw = await readBody(req, maxBytes);
    } catch (e) {
      if (e instanceof AppError) {
        json(res, e.status, errorBody(e.code, e.message, e.details));
        return;
      }
      throw e;
    }
  }

  let body: unknown = undefined;
  if (raw.length > 0) {
    if (route.bodyKind === 'import') {
      body = raw;
    } else {
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        bodyParseError = true;
      }
    }
  }

  // precedence: 413 (handled), 400 bad JSON, 401, 429, 404, 403, 409, 422, 503
  if (bodyParseError && route.bodyKind !== 'none' && raw.length > 0) {
    json(res, 400, errorBody('bad_request', "The request body isn't valid JSON."));
    return;
  }
  if (route.needsAuth && !user) {
    json(res, 401, errorBody('unauthenticated', 'Sign in to continue.'));
    return;
  }
  // rate limiting
  if (user && route.write) {
    const client = await db.pool.connect();
    try {
      const secs = await checkRate(client, user.id, 'write', env.settings.writeRate, ctx.now());
      if (secs !== null) {
        json(res, 429, errorBody('rate_limited', `Too many requests. Try again in ${secs} seconds.`));
        return;
      }
    } finally {
      client.release();
    }
  }

  const rc: RequestCtx = {
    ctx,
    req,
    res,
    method,
    path,
    query: url.searchParams,
    params,
    user,
    raw,
    body,
    idemKey: (req.headers['idempotency-key'] as string | undefined) ?? null,
  };

  // idempotency replay
  if (route.idempotent && rc.idemKey && user) {
    const client = await db.pool.connect();
    try {
      const stored = (await client.query<{ status: number; body: string | null; method: string; path: string }>(
        `SELECT status, body, method, path FROM idempotency_keys WHERE user_id = $1 AND key = $2`, [user.id, rc.idemKey],
      )).rows[0];
      if (stored) {
        if (stored.body !== raw.toString('utf8')) {
          json(res, 409, errorBody('idempotency_conflict', 'This idempotency key was used with a different request.'));
          return;
        }
        res.setHeader('Idempotent-Replay', 'true');
        res.writeHead(stored.status, { 'Content-Type': 'application/json; charset=utf-8', 'Idempotent-Replay': 'true' });
        res.end(stored.body ?? '');
        return;
      }
    } finally {
      client.release();
    }
  }

  try {
    const result = await route.handler(rc);
    if (result && typeof result === 'object' && '__handled' in (result as Record<string, unknown>)) {
      return;
    }
    if (result && typeof result === 'object' && '__file' in (result as Record<string, unknown>)) {
      const file = (result as { __file: string; __type?: string }).__file;
      res.writeHead(200, { 'Content-Type': (result as { __type?: string }).__type ?? 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(file, 'utf8') });
      res.end(file);
      return;
    }
    // Published statuses: POST creates answer 201, session and the grading
    // control routes answer 200, and every other verb answers 200.
    let status = method === 'POST' ? 201 : 200;
    if (method === 'POST') {
      if (path === '/api/session' || path === '/api/grading/session' || path === '/api/users') {
        status = path === '/api/users' ? 201 : 200;
      } else if (path.startsWith('/api/grading/')) {
        status = path === '/api/grading/seed' ? 201 : 200;
      }
    }
    if (result === null && method === 'DELETE') {
      res.writeHead(204);
      res.end();
      return;
    }
    const bodyText = JSON.stringify(result ?? {});
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(bodyText) });
    res.end(bodyText);
    if (route.idempotent && rc.idemKey && user) {
      const client = await db.pool.connect();
      try {
        await client.query(`INSERT INTO idempotency_keys (user_id, key, method, path, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (user_id, key) DO NOTHING`, [user.id, rc.idemKey, method, path, status, bodyText, ctx.now()]);
      } finally {
        client.release();
      }
    }
  } catch (e) {
    if (e instanceof AppError) {
      json(res, e.status, errorBody(e.code, e.message, e.details));
      if (route.idempotent && rc.idemKey && user && e.status < 500) {
        const client = await db.pool.connect();
        try {
          await client.query(`INSERT INTO idempotency_keys (user_id, key, method, path, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (user_id, key) DO NOTHING`, [user.id, rc.idemKey, method, path, e.status, JSON.stringify(errorBody(e.code, e.message, e.details)), ctx.now()]);
        } finally {
          client.release();
        }
      }
      return;
    }
    throw e;
  }
}

// WebSocket live channel
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/api/live') {
    socket.destroy();
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['spur_session'] ?? null;
  void (async () => {
    const user = await loadUser(ctx, token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const projectId = Number(url.searchParams.get('project'));
    const since = url.searchParams.get('since') !== null ? Number(url.searchParams.get('since')) : null;
    const { effectiveAccess } = await import('./domain/access.js');
    const client = await db.pool.connect();
    let access;
    try {
      access = await effectiveAccess(client, projectId, user.id);
    } finally {
      client.release();
    }
    if (!access.member && !access.implied) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void (async () => {
        if (since !== null) {
          const client = await db.pool.connect();
          try {
            const catchUp = await liveLog.catchUp(client, projectId, since);
            if (catchUp.resync) {
              ws.send(JSON.stringify({ type: 'resync' }));
            } else {
              for (const m of catchUp.messages) {
                ws.send(JSON.stringify(m));
              }
            }
          } finally {
            client.release();
          }
        }
        liveLog.attachMemory(projectId);
        const unsubscribe = ctx.subscribe(projectId, (m) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(m));
          }
        });
        const pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.ping();
        }, 30_000);
        ws.on('close', () => {
          unsubscribe();
          clearInterval(pingTimer);
        });
        ws.on('error', () => undefined);
      })();
    });
  })();
}) as never;

// job log SSE stream is handled as a normal GET returning an event-stream
router.add('GET', '/api/jobs/:jid/log/stream', (async (rc: RequestCtx) => {
  const jid = Number(rc.params.jid);
  const job = (await rc.ctx.db.query<{ project_id: number }>(`SELECT project_id FROM jobs WHERE id = $1`, [jid])).rows[0];
  if (!job) throw new AppError(404, 'not_found', 'Not found.');
  const { effectiveAccess } = await import('./domain/access.js');
  const client = await rc.ctx.db.pool.connect();
  try {
    const access = await effectiveAccess(client, job.project_id, rc.user!.id);
    if (!access.member && !access.implied) throw new AppError(404, 'not_found', 'Not found.');
  } finally {
    client.release();
  }
  const heartbeat = rc.ctx.settings.sseHeartbeatMs;
  rc.res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  let lastLine = 0;
  let finished = false;
  const sendLines = (): void => {
    void (async () => {
      const lines = (await rc.ctx.db.query<{ n: number; stream: string; text: string }>(`SELECT n, stream, text FROM job_log_lines WHERE job_id = $1 AND n > $2 ORDER BY n`, [jid, lastLine])).rows;
      for (const l of lines) {
        lastLine = l.n;
        rc.res.write(`event: line\ndata: ${l.n} ${l.stream} ${l.text}\n\n`);
      }
      const status = (await rc.ctx.db.query<{ status: string }>(`SELECT status FROM jobs WHERE id = $1`, [jid])).rows[0]?.status;
      if (['success', 'failed', 'canceled', 'warning', 'skipped'].includes(status) && !finished) {
        finished = true;
        rc.res.write(`event: end\ndata: ${JSON.stringify({ status })}\n\n`);
        rc.res.end();
        if (timer) clearInterval(timer);
      }
    })();
  };
  sendLines();
  const timer = setInterval(() => {
    if (finished) {
      clearInterval(timer);
      return;
    }
    rc.res.write(`: heartbeat\n\n`);
    sendLines();
  }, heartbeat);
  rc.req.on('close', () => {
    if (timer) clearInterval(timer);
  });
  return { __handled: true };
}) as never, { write: false });

async function main(): Promise<void> {
  // schema retry loop
  for (;;) {
    const ok = await (async () => {
      try {
        await applySchema(db);
        return true;
      } catch {
        return false;
      }
    })();
    if (ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // demo seed on empty database
  try {
    const count = (await db.query<{ n: string }>(`SELECT count(*) AS n FROM users WHERE is_system = false`)).rows[0];
    if (Number(count?.n ?? 0) === 0) {
      await seedDemo(ctx);
    }
  } catch {
    // ignore seed failure
  }
  server.listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`spurline listening on ${env.port}\n`);
  });
}

void main();
