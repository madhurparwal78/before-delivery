import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadConfig } from './config';
import { migrate } from './migrate';
import { closePool, query, transaction } from './db';
import { ERRORS, errorBody, HttpError, type Ctx } from './http';
import { freshScriptNonce, securityHeaders } from './headers';
import { parseCookies, assertSameOrigin } from './router';
import {
  createSessionTokens, loadProfile, rotateRefresh, revokeFamily, revokeJti, verifyAccess, familyChangeToken, type GameAndStaff,
} from './auth';
import { verifyPassword } from './passwords';
import { decide, effectivePermissions, TOPICS, type Action, type StoredRule, type ThreadStatus, type Topic } from './domain';
import { inboxQuery, decodeCursor } from './inbox';
import { loadThread, threadStatistics, threadMessages, serialiseThreadMessages, storePlayerMessage, storeReply, threadTopicCache, type ThreadRecord } from './threads';
import { loadForensics, replyForensics, emptyForensics } from './forensics';
import { loadAttachment, settleAttachment } from './attachments';
import { scheduleStore, readAttachment } from './storage';
import { cleanFilename, contentDisposition, detectType } from './files';
import { takeToken, readBucket, bucketCapacity } from './bucket';
import { beginIdempotent, completeIdempotent, releaseIdempotent } from './idempotency';
import { acceptEvent, loadGameBySlug, recordRefusal, verifySignature, timestampWindowOk } from './events';
import { purchaseViews } from './purchases';
import { lookupReceipts } from './receiptLookup';
import { subscribe, publish } from './live';
import { hmacSha256Hex, newId, newToken, timingSafeEqualHex, sha256Hex } from './crypto';
import { serialiseAttachment, iso, type AttachmentRow, type MessageRow } from './serialise';

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
};

const MAX_JSON = 65_536;
const MAX_UPLOAD = 5_000_000;

interface Route {
  method: string;
  segments: string[];
  handler: (ctx: Ctx, params: Record<string, string>) => Promise<unknown>;
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((part) => part !== '');
}

function makeCtx(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer): Ctx {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  let heldNonce: string | null = null;
  const send = (payload: unknown, status = 200, headers: Record<string, string> = {}) => {
    if (res.writableEnded) return;
    const frameAncestors = typeof headers['frame-ancestors'] === 'string' ? headers['frame-ancestors'] : "'none'";
    const sandboxed = headers['content-sandbox'] === 'sandbox';
    const nonce = heldNonce ?? freshScriptNonce();
    const all = { ...securityHeaders(nonce, frameAncestors, sandboxed), ...headers };
    delete all['frame-ancestors'];
    delete all['content-sandbox'];
    if (payload === undefined) {
      res.writeHead(status, all);
      res.end();
      return;
    }
    const bytes = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), 'utf8');
    res.writeHead(status, { ...all, 'content-length': String(bytes.length) });
    res.end(bytes);
  };
  const holdNonce = (value: string): void => {
    heldNonce = value;
  };
  const context: Ctx = {
    req,
    res,
    url,
    method: (req.method ?? 'GET').toUpperCase(),
    cookies: parseCookies(req.headers.cookie),
    send,
    json: null,
    rawBody: body,
    params: {},
  };
  (context as Ctx & { holdNonce: (value: string) => void }).holdNonce = holdNonce;
  return context;
}

async function readBody(req: http.IncomingMessage, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    total += piece.length;
    if (total > cap) throw ERRORS.tooLarge();
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function jsonError(error: unknown): { status: number; body: unknown } {
  if (error instanceof HttpError) {
    return { status: error.status, body: errorBody(error.code, error.message, error.fields) };
  }
  console.error('unhandled error', error);
  return { status: 500, body: errorBody('server_error', 'Something went wrong. Try again.') };
}

const routes: Route[] = [];

function route(method: string, path: string, handler: (ctx: Ctx, params: Record<string, string>) => Promise<unknown>): void {
  routes.push({ method, segments: segmentsOf(path), handler });
}

function matchRoute(method: string, path: string): { handler: (ctx: Ctx, params: Record<string, string>) => Promise<unknown>; params: Record<string, string> } | null {
  const parts = segmentsOf(path);
  for (const entry of routes) {
    if (entry.method !== method) continue;
    if (entry.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < entry.segments.length; i += 1) {
      const spec = entry.segments[i];
      if (spec.startsWith(':')) {
        params[spec.slice(1)] = decodeURIComponent(parts[i]);
      } else if (spec !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: entry.handler, params };
  }
  return null;
}

// ---- staff context ----

interface StaffContext {
  staffId: string;
  gameId: string;
  role: 'developer' | 'moderator';
  familyId: string;
  jti: string;
  developer: boolean;
  rules: StoredRule[];
  changeToken: string;
}

async function staffCtx(ctx: Ctx): Promise<StaffContext> {
  const token = ctx.cookies['hl_access'];
  if (!token) throw ERRORS.unauthenticated();
  const claims = await verifyAccess(token);
  const profile = await loadProfile(claims.staffId);
  const rules = profile.staff.role === 'developer' ? [] : await loadRules(profile.staff.id);
  const changeToken = await familyChangeToken(claims.familyId);
  if (!changeToken) throw ERRORS.unauthenticated();
  return {
    staffId: profile.staff.id,
    gameId: profile.game.id,
    role: profile.staff.role,
    familyId: claims.familyId,
    jti: claims.jti,
    developer: profile.staff.role === 'developer',
    rules,
    changeToken,
  };
}

async function requireChangeToken(ctx: Ctx, staff: StaffContext): Promise<void> {
  assertSameOrigin(ctx);
  const provided = ctx.req.headers['x-change-token'];
  if (typeof provided !== 'string' || !timingSafeEqualHex(provided, staff.changeToken)) {
    throw ERRORS.changeRefused();
  }
}

async function loadRules(moderatorId: string): Promise<StoredRule[]> {
  const result = await query<{ id: string; effect: 'grant' | 'deny'; action: Action; topic: StoredRule['topic']; position: string }>(
    'SELECT id, effect, action, topic, position FROM rules WHERE moderator_id = $1 ORDER BY position ASC',
    [moderatorId],
  );
  return result.rows.map((row) => ({ id: row.id, effect: row.effect, action: row.action, topic: row.topic, position: Number(row.position) }));
}

function mayRead(staff: StaffContext, topic: Topic): boolean {
  return staff.developer || decide(staff.rules, 'read', topic).allowed;
}

function mayAct(staff: StaffContext, action: Action, topic: Topic): boolean {
  return staff.developer || decide(staff.rules, action, topic).allowed;
}

async function threadForStaff(staff: StaffContext, threadId: string): Promise<ThreadRecord> {
  const thread = await loadThread(threadId);
  if (!thread || thread.game_id !== staff.gameId) throw ERRORS.notFound();
  if (!mayRead(staff, thread.topic)) throw ERRORS.notFound();
  return thread;
}

// ---- player context ----

interface PlayerContext {
  gameId: string;
  gameSlug: string;
  gameName: string;
  launcherOrigin: string;
  playerId: string;
  playerName: string;
}

async function playerCtx(ctx: Ctx, gameSlug: string): Promise<PlayerContext> {
  const playerId = ctx.req.headers['x-hushline-player'];
  const signature = ctx.req.headers['x-hushline-player-signature'];
  if (typeof playerId !== 'string' || typeof signature !== 'string' || playerId === '') throw ERRORS.invalidIdentity();
  const game = await loadGameBySlug(gameSlug);
  if (!game) throw ERRORS.invalidIdentity();
  const expected = hmacSha256Hex(widgetSecretOf(game), playerId);
  if (!timingSafeEqualHex(expected, signature)) throw ERRORS.invalidIdentity();
  const player = await query<{ id: string; name: string }>('SELECT id, name FROM players WHERE game_id=$1 AND id=$2', [game.id, playerId]);
  if (player.rows.length === 0) {
    await query('INSERT INTO players (id, game_id, name) VALUES ($1,$2,$1) ON CONFLICT DO NOTHING', [playerId, game.id]);
    await query('INSERT INTO buckets (game_id, player_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [game.id, playerId]);
    return { gameId: game.id, gameSlug: game.slug, gameName: game.name, launcherOrigin: launcherOriginOf(game), playerId, playerName: playerId };
  }
  return { gameId: game.id, gameSlug: game.slug, gameName: game.name, launcherOrigin: launcherOriginOf(game), playerId, playerName: player.rows[0].name };
}

const launcherOrigins = new Map<string, string>();

function widgetSecretOf(game: { id: string; slug: string }): string {
  return widgetSecrets.get(game.id) ?? '';
}

function launcherOriginOf(game: { id: string }): string {
  return launcherOrigins.get(game.id) ?? "'none'";
}

const widgetSecrets = new Map<string, string>();

async function refreshGameCache(): Promise<void> {
  const games = await query<{ id: string; widget_secret: string; launcher_origin: string }>('SELECT id, widget_secret, launcher_origin FROM games');
  for (const row of games.rows) {
    widgetSecrets.set(row.id, row.widget_secret);
    launcherOrigins.set(row.id, row.launcher_origin);
  }
}

// ---- register routes ----

route('GET', '/api/health', async () => ({ status: 'ok' }));

route('POST', '/api/auth/login', async (ctx) => {
  assertSameOrigin(ctx);
  requireJson(ctx);
  const body = asObject(ctx.json);
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fields: Record<string, string> = {};
  if (email.trim() === '') fields.email = 'Enter your email.';
  if (password === '') fields.password = 'Enter your password.';
  if (Object.keys(fields).length > 0) throw ERRORS.validation(fields);
  const found = await query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM staff WHERE email = $1', [email.trim().toLowerCase()]);
  if (found.rows.length === 0) throw ERRORS.invalidCredentials();
  const ok = await verifyPassword(found.rows[0].password_hash, password);
  if (!ok) throw ERRORS.invalidCredentials();
  const session = await createSessionTokens(found.rows[0].id);
  setSessionCookies(ctx, session.accessToken, session.refreshToken);
  return { user: { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role }, game: session.game, change_token: session.change_token };
});

route('GET', '/api/auth/session', async (ctx) => {
  const staff = await staffCtx(ctx);
  const profile = await loadProfile(staff.staffId);
  return {
    user: { id: profile.staff.id, name: profile.staff.name, email: profile.staff.email, role: profile.staff.role },
    game: profile.game,
    change_token: staff.changeToken,
  };
});

route('POST', '/api/auth/refresh', async (ctx) => {
  const token = ctx.cookies['hl_refresh'];
  if (!token) throw ERRORS.unauthenticated();
  const session = await rotateRefresh(token);
  setSessionCookies(ctx, session.accessToken, session.refreshToken);
  return { user: { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role }, game: session.game, change_token: session.change_token };
});

route('POST', '/api/auth/logout', async (ctx) => {
  const staff = await staffCtx(ctx);
  await requireChangeToken(ctx, staff);
  await revokeJti(staff.jti, new Date(Date.now() + 60_000));
  await revokeFamily(staff.familyId);
  clearSessionCookies(ctx);
  return { __status: 204 };
});

route('GET', '/api/inbox', async (ctx) => {
  const staff = await staffCtx(ctx);
  const statusParam = ctx.url.searchParams.get('status');
  const q = ctx.url.searchParams.get('q') ?? '';
  const limitRaw = ctx.url.searchParams.get('limit');
  const cursorRaw = ctx.url.searchParams.get('cursor');
  let status: ThreadStatus = 'waiting';
  if (statusParam !== null) {
    if (statusParam !== 'waiting' && statusParam !== 'answered' && statusParam !== 'closed') throw ERRORS.validation({ status: 'Choose waiting, answered or closed.' });
    status = statusParam;
  }
  let limit = 25;
  if (limitRaw !== null) {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100) throw ERRORS.validation({ limit: 'Choose a page size from 1 to 100.' });
    limit = Number(limitRaw);
  }
  let cursor = null;
  if (cursorRaw !== null) {
    cursor = decodeCursor(cursorRaw, status, q);
    if (!cursor) throw ERRORS.validation({ cursor: 'Start the list again.' });
  }
  const counts: Record<ThreadStatus, number> = { waiting: 0, answered: 0, closed: 0 };
  const statuses: ThreadStatus[] = ['waiting', 'answered', 'closed'];
  for (const value of statuses) {
    const counted = await inboxQuery({ gameId: staff.gameId, status: value, q, developer: staff.developer, rules: staff.rules, countOnly: true });
    counts[value] = counted.total;
  }
  const page = await inboxQuery({ gameId: staff.gameId, status, q, developer: staff.developer, rules: staff.rules, countOnly: false, limit, cursor });
  return {
    counts,
    threads: page.rows.map((row) => ({
      id: row.id,
      status: row.status,
      topic: row.topic,
      player: { id: row.player_id, name: row.player_name },
      first_line: row.first_line,
      last_player_message_at: iso(row.last_player_message_at),
      waiting_since: iso(row.waiting_since),
    })),
    next_cursor: page.nextCursor,
  };
});

route('GET', '/api/threads/:id', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  const thread = await threadForStaff(staff, params.id);
  return threadBody(staff, thread);
});

route('POST', '/api/threads/:id/replies', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  requireJson(ctx);
  const thread = await threadForStaff(staff, params.id);
  if (!mayAct(staff, 'reply', thread.topic)) throw ERRORS.forbidden();
  await requireChangeToken(ctx, staff);
  const body = asObject(ctx.json);
  const text = typeof body.body === 'string' ? body.body : '';
  const key = idempotencyKey(ctx);
  const fingerprint = `reply|${thread.id}|${JSON.stringify(body.body ?? null)}`;
  const outcome = await beginIdempotent({ key, scopeKey: `staff:${staff.staffId}:reply`, fingerprint });
  if (outcome.replay) return { __status: outcome.replay.status, __body: outcome.replay.body, __headers: { 'idempotent-replay': 'true' } };
  const claimId = outcome.claimId!;
  try {
    const trimmed = text.trim();
    if (trimmed === '') {
      await releaseIdempotent(claimId);
      throw ERRORS.validation({ body: 'Write a reply before sending.' });
    }
    if (text.length > 4000) {
      await releaseIdempotent(claimId);
      throw ERRORS.validation({ body: 'Replies can be up to 4,000 characters.' });
    }
    if (thread.status === 'closed') {
      await releaseIdempotent(claimId);
      throw ERRORS.threadClosed();
    }
    const profile = await loadProfile(staff.staffId);
    const stored = await storeReply({
      gameId: staff.gameId,
      threadId: thread.id,
      authorId: staff.staffId,
      authorName: profile.staff.name,
      authorRole: profile.staff.role,
      body: trimmed,
    });
    const message = await messageById(stored.messageId);
    const responseBody = { message, thread: { id: thread.id, status: 'answered' as ThreadStatus } };
    await completeIdempotent(claimId, 201, responseBody);
    return { __status: 201, __body: responseBody };
  } catch (error) {
    await releaseIdempotent(claimId);
    throw error;
  }
});

route('POST', '/api/threads/:id/close', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  const thread = await threadForStaff(staff, params.id);
  if (!mayAct(staff, 'close', thread.topic)) throw ERRORS.forbidden();
  await requireChangeToken(ctx, staff);
  const moved = await transaction(async (client) => {
    const rows = await client.query<{ id: string }>(
      `UPDATE threads SET status='closed', waiting_since=NULL
        WHERE id=$1 AND game_id=$2 AND status='answered'
        RETURNING id`,
      [thread.id, staff.gameId],
    );
    if (rows.rows.length === 0) return false;
    await client.query('INSERT INTO closes (thread_id, closed_at) VALUES ($1, now())', [thread.id]);
    return true;
  });
  if (!moved) {
    const fresh = await loadThread(thread.id);
    if (!fresh) throw ERRORS.notFound();
    if (fresh.status === 'waiting') throw ERRORS.notAnswered();
    throw ERRORS.alreadyClosed();
  }
  publish({ event: 'thread_status', gameId: staff.gameId, threadId: thread.id, payload: { status: 'closed' } });
  return { thread: { id: thread.id, status: 'closed' as ThreadStatus } };
});

route('GET', '/api/threads/:id/receipt-lookup', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  const thread = await threadForStaff(staff, params.id);
  if (!mayAct(staff, 'receipts', thread.topic)) throw ERRORS.forbidden();
  const receiptIds = await threadReceiptIds(staff.gameId, thread.id);
  const purchases = await purchaseViews(staff.gameId, receiptIds);
  const slug = await gameSlugOf(staff.gameId);
  return lookupReceipts(slug, thread.player_id, purchases);
});

route('GET', '/api/messages/:id/forensics', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  const message = await messageWithGame(params.id);
  if (!message || message.game_id !== staff.gameId) throw ERRORS.notFound();
  const thread = await loadThread(message.thread_id);
  if (!thread || !mayRead(staff, thread.topic)) throw ERRORS.notFound();
  if (message.kind === 'event' && !mayAct(staff, 'receipts', thread.topic) && (message.event_type === 'purchase.receipt' || message.event_type === 'purchase.refunded')) {
    throw ERRORS.notFound();
  }
  if (message.kind === 'reply') return replyForensics(message.id);
  const forensics = await loadForensics(message.id);
  if (!forensics) throw ERRORS.notFound();
  return forensics;
});

route('GET', '/api/messages/:id/forensics/stream', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  const message = await messageWithGame(params.id);
  if (!message || message.game_id !== staff.gameId) throw ERRORS.notFound();
  const thread = await loadThread(message.thread_id);
  if (!thread || !mayRead(staff, thread.topic)) throw ERRORS.notFound();
  const stream = await openEventStream(ctx);
  const forensics = message.kind === 'reply' ? replyForensics(message.id) : await loadForensics(message.id);
  if (forensics) {
    for (const line of forensics.lines) {
      await stream.write({ event: 'stage', data: line });
    }
    await stream.write({ event: 'settled', data: forensics });
  }
  stream.close();
  return undefined;
});

route('GET', '/api/attachments/:id', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  const attachment = await attachmentWithGame(params.id);
  if (!attachment || attachment.game_id !== staff.gameId) throw ERRORS.notFound();
  const thread = await threadOfMessage(attachment.message_id);
  if (!thread || !mayRead(staff, thread.topic)) throw ERRORS.notFound();
  return serialiseAttachment(attachment);
});

route('GET', '/api/attachments/:id/content', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  const attachment = await attachmentWithGame(params.id);
  if (!attachment || attachment.game_id !== staff.gameId) throw ERRORS.notFound();
  const thread = await threadOfMessage(attachment.message_id);
  if (!thread || !mayRead(staff, thread.topic)) throw ERRORS.notFound();
  if (attachment.status !== 'attached') throw ERRORS.notAttached();
  const slug = await gameSlugOf(staff.gameId);
  const bytes = await readAttachment(slug, attachment.id);
  if (!bytes) throw ERRORS.notAttached();
  ctx.send(bytes, 200, {
    'content-type': servedType(attachment.content_type),
    'content-disposition': contentDisposition(attachment.filename),
    'content-sandbox': 'sandbox',
    'x-content-type-options': 'nosniff',
  });
  return undefined;
});

route('GET', '/api/stream', async (ctx) => {
  const staff = await staffCtx(ctx);
  await openWorkspaceStream(ctx, staff);
  return undefined;
});

route('GET', '/api/team', async (ctx) => {
  const staff = await staffCtx(ctx);
  if (!staff.developer) throw ERRORS.forbidden();
  const moderators = await query<{ id: string; name: string; email: string }>(
    'SELECT id, name, email FROM staff WHERE game_id = $1 AND role = \'moderator\' ORDER BY created_at, id',
    [staff.gameId],
  );
  const list = [];
  for (const moderator of moderators.rows) {
    const rules = await loadRules(moderator.id);
    list.push({ id: moderator.id, name: moderator.name, email: moderator.email, rules: rules.map((rule) => ({ id: rule.id, effect: rule.effect, action: rule.action, topic: rule.topic })) });
  }
  return { moderators: list };
});

route('POST', '/api/team/:id/rules', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  if (!staff.developer) throw ERRORS.forbidden();
  requireJson(ctx);
  const moderator = await query<{ id: string; game_id: string }>('SELECT id, game_id FROM staff WHERE id = $1', [params.id]);
  if (moderator.rows.length === 0 || moderator.rows[0].game_id !== staff.gameId) throw ERRORS.notFound();
  await requireChangeToken(ctx, staff);
  const body = asObject(ctx.json);
  const effect = body.effect;
  const action = body.action;
  const topic = body.topic;
  const fields: Record<string, string> = {};
  if (effect !== 'grant' && effect !== 'deny') fields.effect = 'Choose grant or deny.';
  if (action !== 'read' && action !== 'reply' && action !== 'close' && action !== 'receipts') fields.action = 'Choose read, reply, close or receipts.';
  if (topic !== 'bug' && topic !== 'account' && topic !== 'purchase' && topic !== 'other' && topic !== '*') fields.topic = 'Choose bug, account, purchase, other or all topics.';
  if (Object.keys(fields).length > 0) throw ERRORS.validation(fields);
  const existing = await query<{ id: string }>(
    'SELECT id FROM rules WHERE moderator_id=$1 AND effect=$2 AND action=$3 AND topic=$4',
    [params.id, effect, action, topic],
  );
  if (existing.rows.length > 0) {
    const rule = existing.rows[0];
    return { __status: 200, __body: { rule: { id: rule.id, effect, action, topic } } };
  }
  const ruleId = newId('rule');
  const position = await query<{ next: string }>('SELECT COALESCE(MAX(position),0)+1 AS next FROM rules');
  await transaction(async (client) => {
    await client.query('INSERT INTO rules (id, moderator_id, effect, action, topic, position) VALUES ($1,$2,$3,$4,$5,$6)', [ruleId, params.id, effect, action, topic, Number(position.rows[0].next)]);
  });
  publish({ event: 'rules_changed', gameId: staff.gameId, threadId: null, payload: { moderator_id: params.id } });
  return { __status: 201, __body: { rule: { id: ruleId, effect, action, topic } } };
});

route('DELETE', '/api/team/:id/rules/:ruleId', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  if (!staff.developer) throw ERRORS.forbidden();
  const moderator = await query<{ id: string; game_id: string }>('SELECT id, game_id FROM staff WHERE id = $1', [params.id]);
  if (moderator.rows.length === 0 || moderator.rows[0].game_id !== staff.gameId) throw ERRORS.notFound();
  await requireChangeToken(ctx, staff);
  const removed = await transaction(async (client) => {
    const rows = await client.query('DELETE FROM rules WHERE id=$1 AND moderator_id=$2 RETURNING id', [params.ruleId, params.id]);
    return rows.rows.length > 0;
  });
  if (!removed) throw ERRORS.notFound();
  publish({ event: 'rules_changed', gameId: staff.gameId, threadId: null, payload: { moderator_id: params.id } });
  return { __status: 204 };
});

route('GET', '/api/team/:id/effective', async (ctx, params) => {
  const staff = await staffCtx(ctx);
  if (!staff.developer) throw ERRORS.forbidden();
  const moderator = await query<{ id: string; game_id: string }>('SELECT id, game_id FROM staff WHERE id = $1', [params.id]);
  if (moderator.rows.length === 0 || moderator.rows[0].game_id !== staff.gameId) throw ERRORS.notFound();
  const rules = await loadRules(params.id);
  return { effective: effectivePermissions(rules) };
});

route('PUT', '/api/game/server-secret', async (ctx) => {
  const staff = await staffCtx(ctx);
  if (!staff.developer) throw ERRORS.forbidden();
  requireJson(ctx);
  await requireChangeToken(ctx, staff);
  const body = asObject(ctx.json);
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (secret.length < 16 || secret.length > 128 || [...secret].some((character) => character.codePointAt(0)! < 0x21 || character.codePointAt(0)! > 0x7E)) {
    throw ERRORS.validation({ secret: 'Choose a secret of 16 to 128 printable characters.' });
  }
  const rotated = await transaction(async (client) => {
    const rows = await client.query<{ previous_valid_until: Date }>(
      `UPDATE games
          SET previous_server_secret = server_secret,
              previous_secret_until = now() + ($2 || ' seconds')::interval,
              server_secret = $3
        WHERE id = $1
        RETURNING previous_secret_until`,
      [staff.gameId, String(loadConfig().secretOverlapSeconds), secret],
    );
    return rows.rows[0]?.previous_valid_until ?? new Date();
  });
  await refreshGameCache();
  return { previous_valid_until: iso(rotated) };
});

// widget routes

route('GET', '/api/widget/:game/me', async (ctx, params) => {
  const player = await playerCtx(ctx, params.game);
  const thread = await query<{ id: string }>('SELECT id FROM threads WHERE game_id=$1 AND player_id=$2', [player.gameId, player.playerId]);
  const bucket = await readBucket(player.gameId, player.playerId);
  return {
    player: { id: player.playerId, name: player.playerName },
    game: { name: player.gameName },
    thread_id: thread.rows[0]?.id ?? null,
    bucket: { level: bucket.level, capacity: bucketCapacity(), retry_after_seconds: bucket.retryAfterSeconds },
  };
});

route('GET', '/api/widget/:game/threads/:id', async (ctx, params) => {
  const player = await playerCtx(ctx, params.game);
  const thread = await loadThread(params.id);
  if (!thread || thread.game_id !== player.gameId || thread.player_id !== player.playerId) throw ERRORS.notFound();
  const messages = await threadMessages(thread.id, player.gameId, false);
  return widgetThreadBody(player, thread, messages);
});

route('POST', '/api/widget/:game/messages', async (ctx, params) => {
  const player = await playerCtx(ctx, params.game);
  requireJson(ctx);
  const body = asObject(ctx.json);
  const text = typeof body.body === 'string' ? body.body : '';
  const topic = body.topic;
  const key = idempotencyKey(ctx);
  const fingerprint = `widget|${player.playerId}|${JSON.stringify(body.body ?? null)}|${JSON.stringify(topic ?? null)}`;
  const outcome = await beginIdempotent({ key, scopeKey: `player:${player.gameId}:${player.playerId}:message`, fingerprint });
  if (outcome.replay) return { __status: outcome.replay.status, __body: outcome.replay.body, __headers: { 'idempotent-replay': 'true' } };
  const claimId = outcome.claimId!;
  try {
    const existingThread = await query<{ id: string; topic: Topic; status: ThreadStatus }>(
      'SELECT id, topic, status FROM threads WHERE game_id=$1 AND player_id=$2',
      [player.gameId, player.playerId],
    );
    let topicValue: Topic | null = null;
    if (existingThread.rows.length === 0) {
      if (topic !== 'bug' && topic !== 'account' && topic !== 'purchase' && topic !== 'other') {
        await releaseIdempotent(claimId);
        throw ERRORS.validation({ topic: 'Choose what this is about.' });
      }
      topicValue = topic;
    }
    const trimmed = text.trim();
    if (trimmed === '') {
      await releaseIdempotent(claimId);
      throw ERRORS.validation({ body: 'Write a message before sending.' });
    }
    if (text.length > 2000) {
      await releaseIdempotent(claimId);
      throw ERRORS.validation({ body: 'Messages can be up to 2,000 characters.' });
    }
    const bucket = await takeToken(player.gameId, player.playerId);
    if (!bucket.ok) {
      await releaseIdempotent(claimId);
      ctx.res.setHeader('retry-after', String(bucket.retryAfterSeconds));
      throw ERRORS.rateLimited(bucket.retryAfterSeconds ?? 1);
    }
    const stored = await storePlayerMessage({
      gameId: player.gameId,
      gameSlug: player.gameSlug,
      gameName: player.gameName,
      playerId: player.playerId,
      playerName: player.playerName,
      body: trimmed,
      topic: topicValue,
      bucket: { previous: bucket.previous, level: bucket.level },
    });
    const message = await messageById(stored.messageId);
    const responseBody = { message, thread: { id: stored.threadId, status: stored.status } };
    await completeIdempotent(claimId, 201, responseBody);
    return { __status: 201, __body: responseBody };
  } catch (error) {
    await releaseIdempotent(claimId);
    throw error;
  }
});

route('POST', '/api/widget/:game/messages/:id/attachments', async (ctx, params) => {
  const player = await playerCtx(ctx, params.game);
  const parts = await readMultipart(ctx, MAX_UPLOAD);
  const file = parts.get('file');
  if (!file) throw ERRORS.validation({ file: 'Attach a PNG, JPEG or plain-text file.' });
  const message = await messageWithGame(params.id);
  if (!message || message.game_id !== player.gameId || message.kind !== 'player') throw ERRORS.notFound();
  const owningPlayer = await query<{ player_id: string }>('SELECT player_id FROM threads WHERE id=$1', [message.thread_id]);
  if (!owningPlayer.rows[0] || owningPlayer.rows[0].player_id !== player.playerId) throw ERRORS.notFound();
  const count = await query<{ count: string }>('SELECT count(*)::text AS count FROM attachments WHERE message_id=$1', [params.id]);
  if (Number(count.rows[0].count) >= 3) throw ERRORS.validation({ file: 'Three files per message at most.' });
  if (file.bytes.length === 0 || file.bytes.length > MAX_UPLOAD) throw ERRORS.validation({ file: 'Attach a PNG, JPEG or plain-text file.' });
  const detected = detectType(file.bytes);
  if (!detected) throw ERRORS.validation({ file: 'Attach a PNG, JPEG or plain-text file.' });
  if ((file.contentType ?? '').toLowerCase() !== detected) throw ERRORS.validation({ file: 'Attach a PNG, JPEG or plain-text file.' });
  const attachmentId = newId('att');
  const filename = cleanFilename(file.filename ?? 'attachment');
  await transaction(async (client) => {
    await client.query(
      'INSERT INTO attachments (id, message_id, game_id, player_id, filename, content_type, size, status) VALUES ($1,$2,$3,$4,$5,$6,$7,\'uploading\')',
      [attachmentId, params.id, player.gameId, player.playerId, filename, detected, file.bytes.length],
    );
  });
  scheduleStore(player.gameSlug, attachmentId, file.bytes, servedType(detected));
  const attachment = await loadAttachment(attachmentId);
  return { __status: 202, __body: { attachment: serialiseAttachment(attachment!) } };
});

route('GET', '/api/widget/:game/attachments/:id', async (ctx, params) => {
  const player = await playerCtx(ctx, params.game);
  const attachment = await attachmentWithGame(params.id);
  if (!attachment || attachment.game_id !== player.gameId || attachment.player_id !== player.playerId) throw ERRORS.notFound();
  return serialiseAttachment(attachment);
});

route('GET', '/api/widget/:game/attachments/:id/content', async (ctx, params) => {
  const player = await playerCtx(ctx, params.game);
  const attachment = await attachmentWithGame(params.id);
  if (!attachment || attachment.game_id !== player.gameId || attachment.player_id !== player.playerId) throw ERRORS.notFound();
  if (attachment.status !== 'attached') throw ERRORS.notAttached();
  const bytes = await readAttachment(player.gameSlug, attachment.id);
  if (!bytes) throw ERRORS.notAttached();
  ctx.send(bytes, 200, {
    'content-type': servedType(attachment.content_type),
    'content-disposition': contentDisposition(attachment.filename),
    'content-sandbox': 'sandbox',
    'x-content-type-options': 'nosniff',
  });
  return undefined;
});

route('POST', '/api/hooks/:game/events', async (ctx, params) => {
  const game = await loadGameBySlug(params.game);
  if (!game) throw ERRORS.notFound();
  const contentType = ctx.req.headers['content-type'] ?? '';
  if (ctx.rawBody.length > 65_536) throw ERRORS.tooLarge();
  if (!contentType.toLowerCase().startsWith('application/json')) throw ERRORS.unsupportedMedia();
  const timestamp = singleHeader(ctx.req.headers['x-hushline-timestamp']);
  const signature = singleHeader(ctx.req.headers['x-hushline-signature']);
  const parsed = parseJsonObject(ctx.rawBody);
  const usedSecret = verifySignature(game, ctx.rawBody, timestamp ?? '', signature ?? '');
  if (usedSecret === null) {
    if (parsed) await recordRefusal(game, parsed, 'signature refused: bad signature', 'current');
    throw ERRORS.badSignature();
  }
  if (!timestampWindowOk(timestamp ?? '')) {
    if (parsed) await recordRefusal(game, parsed, 'signature refused: outside the 300 s window', usedSecret);
    throw ERRORS.staleTimestamp();
  }
  const outcome = await acceptEvent(game, ctx.rawBody, timestamp, signature);
  return { __status: outcome.status, __body: outcome.body };
});

// ---- helpers ----

function requireJson(ctx: Ctx): void {
  const type = (ctx.req.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/json')) throw ERRORS.unsupportedMedia();
  if (ctx.rawBody.length > MAX_JSON) throw ERRORS.tooLarge();
  ctx.json = ctx.rawBody.length === 0 ? {} : parseJsonObject(ctx.rawBody);
  if (ctx.json === null) throw ERRORS.validation({ body: 'This field is missing or not valid.' });
}

function parseJsonObject(raw: Buffer): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function idempotencyKey(ctx: Ctx): string {
  const raw = ctx.req.headers['idempotency-key'];
  const value = singleHeader(raw);
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) {
    throw ERRORS.validation({ idempotency_key: 'Send again from the form.' });
  }
  return value;
}

function setSessionCookies(ctx: Ctx, accessToken: string, refreshToken: string): void {
  const config = loadConfig();
  ctx.res.setHeader('set-cookie', [
    `hl_access=${accessToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.accessTokenTtlSeconds}`,
    `hl_refresh=${refreshToken}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=${config.refreshTokenTtlSeconds}`,
  ]);
}

function clearSessionCookies(ctx: Ctx): void {
  ctx.res.setHeader('set-cookie', [
    'hl_access=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    'hl_refresh=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0',
  ]);
}

function servedType(detected: string): string {
  if (detected === 'text/plain') return 'text/plain; charset=utf-8';
  return detected;
}

async function messageById(id: string): Promise<Record<string, unknown> | null> {
  const result = await query<MessageRow>('SELECT * FROM messages WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  const attachments = await query<AttachmentRow>('SELECT id, message_id, filename, content_type, size, status FROM attachments WHERE message_id = $1 ORDER BY created_at, id', [id]);
  const verdict = await query<{ link_verdict: string; link_title: string | null; link_description: string | null; link_url: string | null }>('SELECT link_verdict, link_title, link_description, link_url FROM verdicts WHERE message_id = $1', [id]);
  const row = verdict.rows[0];
  const unfurl = row && row.link_verdict === 'fetched' && row.link_title ? { url: row.link_url, title: row.link_title, description: row.link_description } : null;
  const serialised = serialiseMessageRow(result.rows[0], attachments.rows, unfurl);
  return serialised;
}

function serialiseMessageRow(row: MessageRow, attachments: { id: string; message_id: string; filename: string; content_type: string; size: string | number; status: 'uploading' | 'attached' | 'failed' }[], unfurl: Record<string, unknown> | null): Record<string, unknown> {
  const event: Record<string, unknown> | null = row.kind === 'event' ? {
    type: row.event_type, verdict: row.event_verdict, receipt_id: row.event_receipt_id, refund_id: row.event_refund_id,
    refund_applied: row.event_refund_applied, item: row.event_item, amount_minor: Number(row.event_amount_minor), currency: row.event_currency,
    match_id: row.event_match_id, mode: row.event_mode, result: row.event_result, duration_seconds: Number(row.event_duration_seconds),
  } : null;
  return {
    id: row.id, kind: row.kind, author: { role: row.author_role, name: row.author_name }, body: row.body, created_at: iso(row.created_at),
    attachments: attachments.map(serialiseAttachment), unfurl, event,
  };
}

async function messageWithGame(id: string): Promise<(MessageRow & { game_id: string }) | null> {
  const result = await query<MessageRow>('SELECT * FROM messages WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

async function attachmentWithGame(id: string): Promise<(AttachmentRow & { game_id: string; player_id: string }) | null> {
  const result = await query<AttachmentRow & { game_id: string; player_id: string }>('SELECT * FROM attachments WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

async function threadOfMessage(messageId: string): Promise<ThreadRecord | null> {
  const result = await query<ThreadRecord & { thread_id: string }>(
    `SELECT t.id, t.game_id, t.player_id, t.topic, t.status, t.waiting_since, t.last_player_message_at, t.created_at
       FROM threads t JOIN messages m ON m.thread_id = t.id WHERE m.id = $1`,
    [messageId],
  );
  return result.rows[0] ?? null;
}

async function threadReceiptIds(gameId: string, threadId: string): Promise<string[]> {
  const result = await query<{ receipt_id: string }>(
    `SELECT DISTINCT m.event_receipt_id AS receipt_id FROM messages m WHERE m.thread_id=$1 AND m.game_id=$2 AND m.kind='event' AND m.event_verdict='accepted' AND m.event_type='purchase.receipt' AND m.event_receipt_id IS NOT NULL`,
    [threadId, gameId],
  );
  return result.rows.map((row) => row.receipt_id);
}

async function gameSlugOf(gameId: string): Promise<string> {
  const result = await query<{ slug: string }>('SELECT slug FROM games WHERE id = $1', [gameId]);
  return result.rows[0].slug;
}

async function threadBody(staff: StaffContext, thread: ThreadRecord): Promise<Record<string, unknown>> {
  const includePurchase = mayAct(staff, 'receipts', thread.topic);
  const messages = await threadMessages(thread.id, staff.gameId, true);
  const serialised = serialiseThreadMessages(messages, true).filter((message) => {
    const event = message.event as { type?: string } | null;
    if (!includePurchase && event && (event.type === 'purchase.receipt' || event.type === 'purchase.refunded')) return false;
    return true;
  });
  const receiptIds = includePurchase ? await threadReceiptIds(staff.gameId, thread.id) : [];
  const purchases = includePurchase ? await purchaseViews(staff.gameId, receiptIds) : [];
  const statistics = await threadStatistics(thread.id);
  return {
    id: thread.id,
    status: thread.status,
    topic: thread.topic,
    player: { id: thread.player_id, name: await playerNameOf(thread.game_id, thread.player_id) },
    waiting_since: iso(thread.waiting_since),
    messages: serialised,
    purchases,
    statistics,
  };
}

function widgetThreadBody(player: PlayerContext, thread: ThreadRecord, messages: Awaited<ReturnType<typeof threadMessages>>): Record<string, unknown> {
  const serialised = serialiseThreadMessages(messages, false).map((message) => {
    if (message.kind === 'reply') {
      return { ...message, author: { role: 'support', name: `${player.gameName} support` } };
    }
    if (message.kind === 'event' && message.event !== null) {
      const event = message.event as { type?: string; verdict?: string };
      if (event.type === 'purchase.receipt' || event.type === 'purchase.refunded' || event.type === 'match.finished') {
        return message;
      }
    }
    return message;
  });
  const receiptIds = messages.filter((row) => row.kind === 'event' && row.event_verdict === 'accepted' && row.event_type === 'purchase.receipt' && row.event_receipt_id !== null).map((row) => row.event_receipt_id!);
  return {
    id: thread.id,
    status: thread.status,
    topic: thread.topic,
    player: { id: player.playerId, name: player.playerName },
    messages: serialised,
    purchases: [],
  };
}

async function playerNameOf(gameId: string, playerId: string): Promise<string> {
  const result = await query<{ name: string }>('SELECT name FROM players WHERE game_id=$1 AND id=$2', [gameId, playerId]);
  return result.rows[0]?.name ?? playerId;
}

interface EventStreamHandle {
  write: (frame: { event: string; data: unknown }) => Promise<void>;
  close: () => void;
}

async function openEventStream(ctx: Ctx): Promise<EventStreamHandle> {
  const headers = securityHeaders(freshScriptNonce(), "'none'");
  ctx.res.writeHead(200, { ...headers, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  ctx.res.write(': ok\n\n');
  let closed = false;
  ctx.req.on('close', () => {
    closed = true;
  });
  const write = async (frame: { event: string; data: unknown }) => {
    if (closed || ctx.res.writableEnded) return;
    ctx.res.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
  };
  return { write, close: () => { closed = true; ctx.res.end(); } };
}

async function openWorkspaceStream(ctx: Ctx, staff: StaffContext): Promise<void> {
  const stream = await openEventStream(ctx);
  const topics = threadTopicCache(staff.gameId);
  const gameThreads = await query<{ id: string; topic: Topic }>('SELECT id, topic FROM threads WHERE game_id = $1', [staff.gameId]);
  for (const row of gameThreads.rows) {
    if (!topics.has(row.id)) topics.set(row.id, row.topic);
  }
  const stop = subscribe({
    gameId: staff.gameId,
    staffId: staff.staffId,
    playerId: null,
    permissionFilter: (frame) => threadVisibleInStream(staff, frame, topics),
    subscriber: (frame) => {
      void stream.write({ event: frame.event, data: { ...frame.payload, thread_id: frame.threadId } });
    },
    stopped: () => {},
  });
  const finish = () => {
    stop();
    stream.close();
  };
  ctx.req.on('close', finish);
}

function threadVisibleInStream(
  staff: StaffContext,
  frame: { event: string; threadId: string | null; gameId: string; payload: Record<string, unknown> },
  topics: Map<string, Topic | null>,
): boolean {
  const threadId = frame.threadId;
  if (threadId === null) {
    return frame.event === 'rules_changed' ? staff.staffId === frame.payload.moderator_id : true;
  }
  if (topics.has(threadId)) {
    const topic = topics.get(threadId);
    return staff.developer || (topic !== null && topic !== undefined && mayRead(staff, topic));
  }
  void loadThread(threadId).then((thread) => {
    topics.set(threadId, thread !== null && thread.game_id === staff.gameId ? thread.topic : null);
  });
  return false;
}

async function readMultipart(ctx: Ctx, cap: number): Promise<Map<string, { filename?: string; contentType?: string; bytes: Buffer }>> {
  const type = ctx.req.headers['content-type'] ?? '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!match) throw ERRORS.unsupportedMedia();
  const boundary = `--${match[1] ?? match[2]}`;
  const parts = new Map<string, { filename?: string; contentType?: string; bytes: Buffer }>();
  const body = ctx.rawBody;
  if (body.length > cap + 1024) throw ERRORS.tooLarge();
  let cursor = 0;
  while (true) {
    const start = body.indexOf(boundary, cursor);
    if (start === -1) break;
    const contentStart = start + boundary.length;
    if (body.slice(contentStart, contentStart + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', contentStart);
    if (headerEnd === -1) break;
    const headerText = body.slice(contentStart, headerEnd).toString('utf8');
    const next = body.indexOf(boundary, headerEnd + 4);
    if (next === -1) break;
    const content = body.slice(headerEnd + 4, next - 2);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerText);
    const key = nameMatch?.[1] ?? 'file';
    parts.set(key, {
      filename: fileMatch ? decodeFilename(fileMatch[1]) : undefined,
      contentType: typeMatch?.[1]?.trim(),
      bytes: Buffer.from(content),
    });
    cursor = next;
  }
  return parts;
}

function decodeFilename(raw: string): string {
  // Browsers escape quotes and percent signs in multipart filenames.
  return raw.replace(/%22/g, '"').replace(/%25/g, '%');
}

// ---- static assets and HTML shell ----

const INDEX_HTML = 'index.html';

function assetRoot(): string {
  const fromCwd = join(process.cwd(), 'public');
  if (existsSync(fromCwd)) return fromCwd;
  return join(import.meta.dirname ?? process.cwd(), '..', '..', 'public');
}

function serveStatic(ctx: Ctx): boolean {
  const pathname = ctx.url.pathname;
  if (pathname === '/' || pathname === '' || ctx.url.pathname.startsWith('/inbox') || ctx.url.pathname.startsWith('/signin') || ctx.url.pathname.startsWith('/team') || ctx.url.pathname.startsWith('/widget')) {
    serveIndex(ctx);
    return true;
  }
  if (pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) {
    const file = join(assetRoot(), pathname);
    if (!file.startsWith(assetRoot()) || !existsSync(file) || !statSync(file).isFile()) {
      ctx.send(notFoundPage(), 404, { 'content-type': 'text/html; charset=utf-8' });
      return true;
    }
    const bytes = readFileSync(file);
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    ctx.send(bytes, 200, { 'content-type': type, 'cache-control': 'no-store' });
    return true;
  }
  ctx.send(notFoundPage(), 404, { 'content-type': 'text/html; charset=utf-8' });
  return true;
}

function serveIndex(ctx: Ctx): void {
  const file = join(assetRoot(), INDEX_HTML);
  if (!existsSync(file)) {
    ctx.send(errorBody('not_found', "There's nothing here."), 404);
    return;
  }
  const template = readFileSync(file, 'utf8');
  const nonce = freshScriptNonce();
  const withNonce = (template as string & { _nonce?: string }) as string;
  (ctx as Ctx & { holdNonce?: (value: string) => void }).holdNonce?.(nonce);
  const html = withNonce.replace(/<script\b/i, `<script nonce="${nonce}"`);
  ctx.send(html, 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
}

function notFoundPage(): string {
  const file = join(assetRoot(), INDEX_HTML);
  if (!existsSync(file)) return '<!doctype html><title>Hushline</title>';
  return readFileSync(file, 'utf8').replace(/<script\b[^>]*>/i, '');
}

// ---- boot ----

async function main(): Promise<void> {
  const config = loadConfig();
  let ready = false;
  while (!ready) {
    try {
      await query('SELECT 1');
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await migrate();
  await refreshGameCache();
  const server = http.createServer(async (req, res) => {
    let body: Buffer = Buffer.alloc(0);
    let ctx: Ctx | null = null;
    try {
      const declared = Number(req.headers['content-length'] ?? '0');
      const cap = (req.headers['content-type'] ?? '').includes('multipart/form-data') ? MAX_UPLOAD + 1024 : MAX_JSON;
      if (declared > cap) throw ERRORS.tooLarge();
      body = await readBody(req, cap);
      ctx = makeCtx(req, res, body);
      const path = ctx.url.pathname;
      if (path === '/api/health') {
        ctx.send({ status: 'ok' }, 200);
        return;
      }
      if (path.startsWith('/api/')) {
        const matched = matchRoute(ctx.method, path);
        if (!matched) {
          ctx.send(errorBody('not_found', "There's nothing here."), 404);
          return;
        }
        const result = await matched.handler(ctx, matched.params);
        if (result !== undefined) {
          if (result && typeof result === 'object' && '__status' in result) {
            const payload = result as { __status: number; __body: unknown; __headers?: Record<string, string> };
            const headers = { ...(payload.__headers ?? {}) };
            if (typeof headers['retry-after'] === 'undefined' && res.getHeader('retry-after')) {
              headers['retry-after'] = String(res.getHeader('retry-after'));
            }
            ctx.send(payload.__body, payload.__status, headers);
            return;
          }
          ctx.send(result, 200);
          return;
        }
        if (!res.writableEnded) return;
        return;
      }
      if (isBlocked(path)) {
        ctx.send(errorBody('not_found', "There's nothing here."), 404);
        return;
      }
      if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
        ctx.send(errorBody('not_found', "There's nothing here."), 404);
        return;
      }
      serveStatic(ctx);
    } catch (error) {
      const mapped = jsonError(error);
      if (!ctx) {
        res.writeHead(mapped.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(mapped.body));
        return;
      }
      if (ctx.url.pathname.startsWith('/api/')) {
        const headers: Record<string, string> = {};
        if (error instanceof HttpError && error.code === 'rate_limited' && error.fields?.retry_after) {
          headers['retry-after'] = error.fields.retry_after;
        }
        ctx.send(mapped.body, mapped.status, headers);
        return;
      }
      ctx.send(notFoundPage(), 404, { 'content-type': 'text/html; charset=utf-8' });
    }
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`hushline listening on ${config.port}`);
  });
}

function isBlocked(path: string): boolean {
  const blocked = ['/.env', '/run.json', '/package.json', '/.git/', '/src/', '/db/', '/tsconfig.json', '/build.mjs', '/package-lock.json', '/THIRD_PARTY_NOTICES.md'];
  return blocked.some((prefix) => path === prefix || path.startsWith(prefix) || path.includes('/.git/'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
