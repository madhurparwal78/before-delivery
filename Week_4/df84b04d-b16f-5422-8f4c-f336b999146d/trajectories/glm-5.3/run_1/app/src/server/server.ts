import type { Pool, QueryResultRow } from 'pg';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomInt } from 'node:crypto';
import { ApiError, newId, newToken, rowToAccount } from './store.js';
import { hashPassword, verifyPassword, hashCode } from './auth.js';
import type { Config } from './config.js';
import { SmtpClient } from './mail.js';
import { LiveHub } from './live-hub.js';
import { WebSocket, WebSocketServer } from 'ws';
import { todayFor } from './config.js';
import { loadScope, buildOutlinePayload, rowToShare } from './outline-service.js';
import { createBullet, patchBullet, moveBullet, mirrorBullet, deleteBullet, withRows, assertOpenable, type MutationContext } from './mutations.js';
import { performUndo, performRedo } from './undo-apply.js';
import { runSearch, runSuggest } from './search.js';
import { buildExport, parseExportFormat } from './export.js';
import { listShares, createShare, retryShare, removeShare, invitationByToken, acceptShare } from './shares.js';
import { runGradingSetup } from './grading.js';
import { isTrashed, branchIds, childRows, placementDepth } from '../domain/tree.js';
import { toBulletView } from '../domain/text.js';
import type { Account, BulletRow, ShareRow } from '../domain/types.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export interface Runtime {
  pool: Pool;
  config: Config;
  smtp: SmtpClient;
  hub: LiveHub;
  webRoot: string;
  ready: boolean;
}

const BODY_LIMIT = 65536;
const GRADING_BODY_LIMIT = 1048576;

function today(rt: Runtime): string {
  return todayFor(rt.config, new Date());
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > limit) {
      throw new ApiError(413, { error: 'too_large' });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function cookieOf(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader('set-cookie', `twig_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('set-cookie', `twig_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function accountOf(rt: Runtime, req: IncomingMessage): Promise<Account | null> {
  const token = cookieOf(req, 'twig_session');
  if (!token) return null;
  const rows = await rt.pool.query(
    `select a.* from sessions s join accounts a on a.id = s.account_id where s.token = $1`,
    [token],
  );
  const row = rows.rows[0];
  return row ? rowToAccount(row) : null;
}

function requireAccount(account: Account | null): Account {
  if (!account) throw new ApiError(401, { error: 'unauthenticated' });
  return account;
}

async function findScopeFor(rt: Runtime, me: Account, id: string): Promise<MutationContext> {
  let ctx = await withRows(rt.pool, rt.config, me, null);
  if (ctx.rows.has(id)) return ctx;
  const shareRows = await rt.pool.query(
    `select distinct s.bullet_id from shares s where s.email = $1 and s.status = 'accepted'`,
    [me.email],
  );
  for (const row of shareRows.rows) {
    const candidate = String(row.bullet_id);
    const branch = await withRows(rt.pool, rt.config, me, candidate);
    if (branch.rows.has(id)) return branch;
  }
  return ctx;
}

async function routeHandler(rt: Runtime, req: IncomingMessage, res: ServerResponse, path: string, method: string, account: Account | null, body: Record<string, unknown>): Promise<void> {
  const segments = path.split('/').filter(Boolean);
  if (path === '/api/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  if (path === '/api/grading/setup' && method === 'POST') {
    const created = await runGradingSetup(rt.pool, rt.config, body as never, today(rt));
    sendJson(res, 201, created as Record<string, unknown>);
    return;
  }
  if (path === '/api/signup' && method === 'POST') {
    const errors = signupErrors(body);
    if (Object.keys(errors).length > 0) {
      throw new ApiError(422, { errors });
    }
    const email = String(body.email ?? '').trim().toLowerCase();
    const existingRows = await rt.pool.query(`select * from accounts where email = $1`, [email]);
    const existing = existingRows.rows[0];
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const minutes = Math.ceil(rt.config.confirmCodeSeconds / 60);
    try {
      if (existing) {
        await rt.smtp.send({
          from: rt.config.mailFrom,
          to: email,
          subject: `Someone tried to sign up with your email`,
          body: `Someone tried to sign up for Twigline with this address. If it was you, sign in at ${rt.config.publicUrl}/signin`,
        });
      } else {
        await rt.smtp.send({
          from: rt.config.mailFrom,
          to: email,
          subject: `Your Twigline code is ${code}`,
          body: `Your Twigline code is ${code}.\nIt expires in ${minutes} minutes.`,
        });
      }
    } catch {
      throw new ApiError(503, { error: 'mail_unavailable' });
    }
    if (existing && existing.confirmed) {
      sendJson(res, 202, { status: 'code_sent' });
      return;
    }
    if (existing && !existing.confirmed) {
      await rt.pool.query(
        `update accounts set name = $2, password_hash = $3 where id = $1`,
        [existing.id, String(body.name ?? '').trim(), hashPassword(String(body.password ?? ''))],
      );
    } else {
      const id = newId();
      await rt.pool.query(
        `insert into accounts (id, email, name, password_hash, confirmed, hide_completed, created_at)
         values ($1,$2,$3,$4,false,false,$5)`,
        [id, email, String(body.name ?? '').trim(), hashPassword(String(body.password ?? '')), Date.now()],
      );
    }
    await rt.pool.query(`delete from signup_codes where email = $1`, [email]);
    await rt.pool.query(
      `insert into signup_codes (id, email, code_hash, expires_at, created_at) values ($1,$2,$3,$4,$5)`,
      [newId(), email, hashCode(code), Date.now() + rt.config.confirmCodeSeconds * 1000, Date.now()],
    );
    sendJson(res, 202, { status: 'code_sent' });
    return;
  }
  if (path === '/api/signup/confirm' && method === 'POST') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const code = String(body.code ?? '').trim();
    const rows = await rt.pool.query(
      `select * from signup_codes where email = $1 order by created_at desc limit 1`,
      [email],
    );
    const row = rows.rows[0];
    if (!row || hashCode(code) !== row.code_hash) {
      throw new ApiError(422, { errors: { code: "That code doesn't match. Check the latest email." } });
    }
    if (Date.now() > Number(row.expires_at)) {
      throw new ApiError(422, { errors: { code: 'That code has expired. Send a new one.' } });
    }
    await rt.pool.query(`update accounts set confirmed = true where email = $1`, [email]);
    await rt.pool.query(`delete from signup_codes where email = $1`, [email]);
    const accountRows = await rt.pool.query(`select * from accounts where email = $1`, [email]);
    const accountRow = accountRows.rows[0];
    if (!accountRow) throw new ApiError(422, { errors: { code: "That code doesn't match. Check the latest email." } });
    const token = newToken();
    await rt.pool.query(`insert into sessions (token, account_id, created_at) values ($1,$2,$3)`, [token, accountRow.id, Date.now()]);
    setSessionCookie(res, token);
    sendJson(res, 200, { user: { id: accountRow.id, email: accountRow.email, name: accountRow.name } });
    return;
  }
  if (path === '/api/session' && method === 'POST') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const rows = await rt.pool.query(`select * from accounts where email = $1`, [email]);
    const row = rows.rows[0];
    if (!row || !row.confirmed || !verifyPassword(password, row.password_hash)) {
      throw new ApiError(401, { error: 'invalid_credentials' });
    }
    const token = newToken();
    await rt.pool.query(`insert into sessions (token, account_id, created_at) values ($1,$2,$3)`, [token, row.id, Date.now()]);
    setSessionCookie(res, token);
    sendJson(res, 200, { user: { id: row.id, email: row.email, name: row.name } });
    return;
  }
  if (path === '/api/session' && method === 'DELETE') {
    const token = cookieOf(req, 'twig_session');
    if (token) {
      await rt.pool.query(`delete from sessions where token = $1`, [token]);
    }
    clearSessionCookie(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (path === '/api/me' && method === 'GET') {
    const me = requireAccount(account);
    const sharedRows = await rt.pool.query(
      `select s.bullet_id, b.text, a.name as owner_name from shares s
       join bullets b on b.id = s.bullet_id
       join accounts a on a.id = s.owner_id
       where s.email = $1 and s.status = 'accepted' and b.trashed_at is null and b.purged = false
       order by s.created_at asc`,
      [me.email],
    );
    sendJson(res, 200, {
      user: { id: me.id, email: me.email, name: me.name, hideCompleted: me.hideCompleted },
      shared: sharedRows.rows.map((r) => ({ bulletId: r.bullet_id, text: r.text, owner: { name: r.owner_name } })),
    });
    return;
  }
  if (path === '/api/me' && method === 'PATCH') {
    const me = requireAccount(account);
    if (typeof body.hideCompleted !== 'boolean') {
      throw new ApiError(422, { errors: { hideCompleted: 'Send true or false.' } });
    }
    await rt.pool.query(`update accounts set hide_completed = $2 where id = $1`, [me.id, body.hideCompleted]);
    const rows = await rt.pool.query(`select * from accounts where id = $1`, [me.id]);
    const updated = rowToAccount(rows.rows[0] as QueryResultRow);
    sendJson(res, 200, {
      user: { id: updated.id, email: updated.email, name: updated.name, hideCompleted: updated.hideCompleted },
      shared: [],
    });
    return;
  }
  if (path === '/api/outline' && method === 'GET') {
    const me = requireAccount(account);
    const url = new URL(req.url ?? '/', 'http://local');
    const rootParam = url.searchParams.get('root');
    const rootId = rootParam && rootParam !== 'home' ? rootParam : null;
    const now = Date.now();
    const loaded = await loadScope(rt.pool, me, rootId, now, rt.config);
    const payload = await buildOutlinePayload(rt.pool, rt.config, loaded.scope, loaded.rows, loaded.root, loaded.ancestors, now);
    sendJson(res, 200, payload as unknown as Record<string, unknown>);
    return;
  }
  if (path === '/api/bullets' && method === 'POST') {
    const me = requireAccount(account);
    const parentId = body.parentId === undefined ? null : typeof body.parentId === 'string' ? body.parentId : null;
    const afterId = typeof body.afterId === 'string' ? body.afterId : null;
    const text = typeof body.text === 'string' ? body.text : '';
    if (typeof body.text !== 'string') {
      throw new ApiError(422, { errors: { text: 'Send a JSON object.' } });
    }
    if (text.length > rt.config.bulletMaxChars) {
      throw new ApiError(422, { errors: { text: `A bullet holds at most ${rt.config.bulletMaxChars} characters.` } });
    }
    const ctx = await withRows(rt.pool, rt.config, me, parentId);
    const result = await createBullet(ctx, parentId, afterId, text, me);
    await broadcastMutation(rt, ctx, result.bullets, result.removed, result.seq);
    sendJson(res, 201, { bullet: result.bullets[0] ?? null, seq: result.seq });
    return;
  }
  if (segments[0] === 'api' && segments[1] === 'bullets' && segments.length === 3) {
    const id = segments[2] ?? '';
    if (method === 'GET') {
      const me = requireAccount(account);
      const bullet = await getBulletFor(rt, me, id);
      sendJson(res, 200, { bullet });
      return;
    }
    if (method === 'PATCH') {
      const me = requireAccount(account);
      const ctx = await findScopeFor(rt, me, id);
      assertOpenable(ctx, id);
      const result = await patchBullet(ctx, id, body);
      await broadcastMutation(rt, ctx, result.bullets, result.removed, result.seq);
      sendJson(res, 200, { bullet: result.bullets[0] ?? null, seq: result.seq });
      return;
    }
    if (method === 'DELETE') {
      const me = requireAccount(account);
      const ctx = await findScopeFor(rt, me, id);
      const result = await deleteBullet(ctx, id, me);
      await broadcastMutation(rt, ctx, [], result.removed, result.seq);
      sendJson(res, 200, { result: result.result, count: result.count, seq: result.seq });
      return;
    }
  }
  if (segments[0] === 'api' && segments[1] === 'bullets' && segments.length === 4) {
    const id = segments[2] ?? '';
    const action = segments[3] ?? '';
    const me = requireAccount(account);
    if (action === 'move' && method === 'POST') {
      const ctx = await findScopeFor(rt, me, id);
      const result = await moveBullet(ctx, id, body, me);
      await broadcastMutation(rt, ctx, result.bullets, result.removed, result.seq);
      sendJson(res, 200, { bullet: result.bullets[0] ?? null, seq: result.seq });
      return;
    }
    if (action === 'mirror' && method === 'POST') {
      const ctx = await findScopeFor(rt, me, id);
      const result = await mirrorBullet(ctx, id, body, me);
      await broadcastMutation(rt, ctx, result.bullets, result.removed, result.seq);
      sendJson(res, 201, { bullet: result.bullets[0] ?? null, seq: result.seq });
      return;
    }
    if (action === 'shares' && method === 'GET') {
      const ctx = await withRows(rt.pool, rt.config, me, null);
      assertOpenable(ctx, id);
      if (ctx.scope.isCollaborator) throw new ApiError(404, { error: 'not_found' });
      const bullet = ctx.rows.get(id) as BulletRow;
      if (bullet.ownerId !== me.id) throw new ApiError(404, { error: 'not_found' });
      const shares = await listShares(rt.pool, id);
      sendJson(res, 200, { shares: shares.map(sharePayload) });
      return;
    }
    if (action === 'shares' && method === 'POST') {
      const ctx = await withRows(rt.pool, rt.config, me, null);
      assertOpenable(ctx, id);
      const bullet = ctx.rows.get(id) as BulletRow;
      if (bullet.ownerId !== me.id) throw new ApiError(404, { error: 'not_found' });
      const share = await createShare(rt.pool, rt.config, rt.smtp, me, id, String(body.email ?? ''), bullet.text);
      sendJson(res, 201, { share: sharePayload(share) });
      return;
    }
  }
  if (segments[0] === 'api' && segments[1] === 'shares' && segments.length === 3) {
    const shareId = segments[2] ?? '';
    const me = requireAccount(account);
    const rows = await rt.pool.query(`select * from shares where id = $1`, [shareId]);
    const row = rows.rows[0];
    if (!row) throw new ApiError(404, { error: 'not_found' });
    const share = rowToShare(row);
    if (share.ownerId !== me.id) throw new ApiError(404, { error: 'not_found' });
    if (method === 'DELETE') {
      const removed = await removeShare(rt.pool, shareId);
      rt.hub.revokeFor(removed.ownerId, removed.bulletId);
      sendJson(res, 200, { share: sharePayload({ ...removed, status: 'revoked' }) });
      return;
    }
    if (method === 'POST' && req.url?.endsWith('/retry')) {
      const bulletRows = await rt.pool.query(`select text from bullets where id = $1`, [share.bulletId]);
      const bulletText = String(bulletRows.rows[0]?.text ?? '');
      const retried = await retryShare(rt.pool, rt.config, rt.smtp, me, shareId, bulletText);
      sendJson(res, 200, { share: sharePayload(retried) });
      return;
    }
  }
  if (segments[0] === 'api' && segments[1] === 'shares' && segments.length === 4 && segments[3] === 'retry') {
    const shareId = segments[2] ?? '';
    const me = requireAccount(account);
    const rows = await rt.pool.query(`select * from shares where id = $1`, [shareId]);
    const row = rows.rows[0];
    if (!row) throw new ApiError(404, { error: 'not_found' });
    const share = rowToShare(row);
    if (share.ownerId !== me.id) throw new ApiError(404, { error: 'not_found' });
    const bulletRows = await rt.pool.query(`select text from bullets where id = $1`, [share.bulletId]);
    const bulletText = String(bulletRows.rows[0]?.text ?? '');
    const retried = await retryShare(rt.pool, rt.config, rt.smtp, me, shareId, bulletText);
    sendJson(res, 200, { share: sharePayload(retried) });
    return;
  }
  if (segments[0] === 'api' && segments[1] === 'invitations' && segments.length === 3 && method === 'GET') {
    const token = segments[2] ?? '';
    const invitation = await invitationByToken(rt.pool, rt.config, token);
    if (!invitation) throw new ApiError(404, { error: 'not_found' });
    sendJson(res, 200, {
      email: invitation.share.email,
      bulletText: invitation.bulletText,
      inviter: { name: invitation.inviterName },
      status: invitation.share.status,
    });
    return;
  }
  if (segments[0] === 'api' && segments[1] === 'invitations' && segments.length === 4 && segments[3] === 'accept' && method === 'POST') {
    const me = requireAccount(account);
    const token = segments[2] ?? '';
    const bulletId = await acceptShare(rt.pool, rt.config, token, me);
    sendJson(res, 200, { bulletId });
    return;
  }
  if (path === '/api/search' && method === 'GET') {
    const me = requireAccount(account);
    const url = new URL(req.url ?? '/', 'http://local');
    const q = url.searchParams.get('q') ?? '';
    const rootParam = url.searchParams.get('root');
    const rootId = rootParam && rootParam !== 'home' ? rootParam : null;
    const result = await runSearch(rt.pool, rt.config, me, rootId, q);
    sendJson(res, 200, result as unknown as Record<string, unknown>);
    return;
  }
  if (path === '/api/suggest' && method === 'GET') {
    const me = requireAccount(account);
    const url = new URL(req.url ?? '/', 'http://local');
    const kind = url.searchParams.get('kind');
    if (kind !== 'tag' && kind !== 'mention') {
      throw new ApiError(422, { errors: { kind: 'Send tag or mention.' } });
    }
    const prefix = url.searchParams.get('prefix') ?? '';
    const rootParam = url.searchParams.get('root');
    const rootId = rootParam && rootParam !== 'home' ? rootParam : null;
    const suggestions = await runSuggest(rt.pool, rt.config, me, rootId, kind, prefix);
    sendJson(res, 200, { suggestions });
    return;
  }
  if (path === '/api/export' && method === 'GET') {
    const me = requireAccount(account);
    const url = new URL(req.url ?? '/', 'http://local');
    const format = parseExportFormat(url.searchParams.get('format'));
    const rootParam = url.searchParams.get('root');
    const rootId = rootParam && rootParam !== 'home' ? rootParam : null;
    const file = await buildExport(rt.pool, rt.config, me, rootId, format);
    res.writeHead(200, {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.filename}"`,
    });
    res.end(file.body);
    return;
  }
  if (path === '/api/undo' && method === 'POST') {
    const me = requireAccount(account);
    const ctx = await withRows(rt.pool, rt.config, me, null);
    const outcome = await performUndo(ctx);
    await broadcastMutation(rt, ctx, outcome.bullets, outcome.removed, outcome.seq);
    sendJson(res, 200, { step: outcome.step, bulletId: outcome.bulletId, seq: outcome.seq });
    return;
  }
  if (path === '/api/redo' && method === 'POST') {
    const me = requireAccount(account);
    const ctx = await withRows(rt.pool, rt.config, me, null);
    const outcome = await performRedo(ctx);
    await broadcastMutation(rt, ctx, outcome.bullets, outcome.removed, outcome.seq);
    sendJson(res, 200, { step: outcome.step, bulletId: outcome.bulletId, seq: outcome.seq });
    return;
  }
  throw new ApiError(404, { error: 'not_found' });
}

function sharePayload(share: ShareRow): Record<string, unknown> {
  return { id: share.id, email: share.email, status: share.status, createdAt: share.createdAt };
}

function signupErrors(body: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (name.length < 1 || name.length > 80) {
    errors.name = 'Enter your name.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (password.length < 10) {
    errors.password = 'Use at least 10 characters.';
  }
  return errors;
}

async function getBulletFor(rt: Runtime, me: Account, id: string): Promise<Record<string, unknown>> {
  const ctx = await findScopeFor(rt, me, id);
  assertOpenable(ctx, id);
  const row = ctx.rows.get(id) as BulletRow;
  const originalId = row.originalId ?? row.id;
  const original = ctx.rows.get(originalId) ?? row;
  const now = Date.now();
  const placeholder = row.originalId !== null && (original.trashedAt !== null || isTrashed(original, now, rt.config.trashSeconds));
  const childCount = childRows(ctx.rows, row.id).filter((r) => !isTrashed(r, now, rt.config.trashSeconds)).length;
  return toBulletView(row, placementDepth(ctx.rows, row.id), placeholder, childCount) as unknown as Record<string, unknown>;
}

async function broadcastMutation(
  rt: Runtime,
  ctx: MutationContext,
  bullets: Record<string, unknown>[],
  removed: string[],
  seq: number,
): Promise<void> {
  const message = { type: 'change', seq, bullets, removed };
  await rt.hub.append(ctx.scope.ownerId, seq, message);
  rt.hub.emitAll(ctx.scope.ownerId, message);
}

async function handleApi(rt: Runtime, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname;
  const isGrading = path === '/api/grading/setup';
  if (isGrading) {
    const key = req.headers['x-grading-key'];
    if (!rt.config.gradingKey || key !== rt.config.gradingKey) {
      throw new ApiError(404, { error: 'not_found' });
    }
  }
  const limit = isGrading ? GRADING_BODY_LIMIT : BODY_LIMIT;
  let body: Record<string, unknown> = {};
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
    const contentType = String(req.headers['content-type'] ?? '');
    const raw = await readBody(req, limit);
    if (!contentType.includes('application/json')) {
      throw new ApiError(415, { error: 'unsupported_media_type' });
    }
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('not object');
        }
      } catch {
        throw new ApiError(422, { errors: { body: 'Send a JSON object.' } });
      }
    }
  } else if (req.method === 'DELETE' && path === '/api/session') {
    body = {};
  }
  const account = await accountOf(rt, req);
  await routeHandler(rt, req, res, path, req.method ?? 'GET', account, body);
}

export function createApp(rt: Runtime): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) {
        await handleApi(rt, req, res);
        return;
      }
      serveStatic(rt, req, res, path);
      return;
    } catch (err) {
      if (err instanceof ApiError) {
        sendJson(res, err.status, err.body);
        return;
      }
      sendJson(res, 500, { error: 'internal' });
      return;
    }
  });
  return server;
}

function serveStatic(rt: Runtime, req: IncomingMessage, res: ServerResponse, path: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  let filePath = path === '/' ? '/index.html' : path;
  if (filePath.startsWith('/fonts/')) {
    const fontPath = join(rt.webRoot, filePath);
    if (existsSync(fontPath)) {
      sendFile(res, fontPath);
      return;
    }
  }
  if (filePath.includes('..')) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const clean = filePath.split('?')[0] ?? filePath;
  const full = join(rt.webRoot, clean);
  if (existsSync(full) && statSync(full).isFile()) {
    sendFile(res, full);
    return;
  }
  const index = join(rt.webRoot, 'index.html');
  if (existsSync(index)) {
    sendFile(res, index, 200);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

function sendFile(res: ServerResponse, full: string, status = 200): void {
  const ext = extname(full);
  const mime = MIME[ext] ?? 'application/octet-stream';
  const data = readFileSync(full);
  res.writeHead(status, {
    'content-type': mime,
    'content-length': data.length,
    'cache-control': 'no-store',
  });
  res.end(data);
}

export async function startServer(pool: Pool, config: Config): Promise<void> {
  const smtp = new SmtpClient(config.smtpHost, config.smtpPort);
  const hub = new LiveHub(config, config.valkeyUrl);
  const webRoot = join(process.cwd(), 'build', 'public');
  const rt: Runtime = { pool, config, smtp, hub, webRoot, ready: true };
  const server = createApp(rt);
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (socket, request) => {
    void handleLive(rt, socket, request);
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== '/api/live') {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
  const heartbeat = setInterval(() => {
    void (async () => {
      const ok = await hub.fanoutOk();
      const message = { type: 'heartbeat', fanout: ok ? 'ok' : 'paused' };
      for (const [socket] of allSockets(hub)) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ ...message, pauseAfter: config.pauseAfterSeconds, heartbeat: config.heartbeatSeconds }));
        }
      }
    })();
  }, Math.max(1, config.heartbeatSeconds) * 1000);
  heartbeat.unref?.();
  const sweeper = setInterval(() => {
    void sweepTrash(rt);
  }, 5000);
  sweeper.unref?.();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`twigline listening on 0.0.0.0:${config.port}`);
  });
}

function allSockets(hub: LiveHub): [WebSocket, { socket: WebSocket; ownerId: string; accountId: string; rootId: string | null; since: number; branch: Set<string> }][] {
  return hub.allSockets();
}

async function sweepTrash(rt: Runtime): Promise<void> {
  const realCutoff = Date.now() - rt.config.trashSeconds * 1000;
  const rows = await rt.pool.query(
    `select id, owner_id, trashed_at from bullets where trashed_at is not null and purged = false and trashed_at < $1`,
    [realCutoff],
  );
  for (const row of rows.rows) {
    await rt.pool.query(`update bullets set purged = true where id = $1`, [row.id]);
    await rt.pool.query(`delete from undo_steps where payload ->> 'bulletId' = $1`, [row.id]);
  }
  if (rows.rows.length > 0) {
    for (const row of rows.rows) {
      await rt.hub.append(String(row.owner_id), Date.now(), { type: 'reload' });
    }
  }
}

async function handleLive(rt: Runtime, socket: WebSocket, req: IncomingMessage): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const rootParam = url.searchParams.get('root');
  const since = Number(url.searchParams.get('since') ?? 0) || 0;
  const token = cookieOf(req, 'twig_session');
  if (!token) {
    socket.close(1008, 'unauthenticated');
    return;
  }
  const rows = await rt.pool.query(
    `select a.* from sessions s join accounts a on a.id = s.account_id where s.token = $1`,
    [token],
  );
  const row = rows.rows[0];
  if (!row) {
    socket.close(1008, 'unauthenticated');
    return;
  }
  const me = rowToAccount(row);
  let rootId: string | null = null;
  if (rootParam && rootParam !== 'home') {
    rootId = rootParam;
    try {
      const ctx = await withRows(rt.pool, rt.config, me, rootId);
      assertOpenable(ctx, rootId);
    } catch {
      socket.send(JSON.stringify({ type: 'revoked' }));
      socket.close();
      return;
    }
  }
  const loaded = await loadScope(rt.pool, me, rootId, Date.now(), rt.config);
  const branchIdsSet = new Set<string>();
  if (rootId) {
    for (const id of branchIds(loaded.rows, rootId)) branchIdsSet.add(id);
  }
  rt.hub.register(socket, {
    socket,
    ownerId: loaded.scope.ownerId,
    accountId: me.id,
    rootId,
    since,
    branch: branchIdsSet,
  });
  const ok = await rt.hub.fanoutOk();
  socket.send(JSON.stringify({
    type: 'heartbeat',
    fanout: ok ? 'ok' : 'paused',
    pauseAfter: rt.config.pauseAfterSeconds,
    heartbeat: rt.config.heartbeatSeconds,
  }));
  if (since > 0) {
    const missed = await rt.hub.readSince(loaded.scope.ownerId, since);
    if (missed.reload) {
      socket.send(JSON.stringify({ type: 'reload' }));
    } else {
      for (const message of missed.messages) {
        socket.send(message);
      }
    }
  }
}
