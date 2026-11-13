import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import pg from 'pg';
import { applySchema } from './schema.js';
import { readConfig, type AppConfig } from '../shared/config.js';
import { ApiError, clearCookie, cookieHeader, empty, json, randomToken, randomUuid, readCookies, type Ctx, type RequestBody } from './http.js';
import { MailService, resetBody, verificationBody } from './mail.js';
import { LiveHub, boardTopic } from './live.js';
import { RoomEngine } from './rooms.js';
import { Store, storedResponseFor, type RunRow, type SettingsRow, type TicketRow } from './store.js';
import { countCodePoints, countWords, normalizeCustomText, roundHalfUp2, sha256Hex, utcDate } from '../shared/format.js';
import { generateWords, quotePick, seedFor, timeWordCount, isLoggedKey, type LogEntry } from '../shared/engine.js';
import { QUOTES } from '../quotes.js';
import { errorsByKeyRows, perSecondSpeeds, replayLog } from '../shared/scoring.js';
import { serveStatic } from './static.js';

const PUBLIC_DIR = path.resolve(process.cwd(), 'dist', 'public');

export interface Server {
  config: AppConfig;
  store: Store;
  mail: MailService;
  hub: LiveHub;
  rooms: RoomEngine;
  ready: boolean;
}

export async function createServer(): Promise<{ server: http.Server; app: Server }> {
  const config = readConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
  const store = new Store(pool);
  const mail = new MailService(store, config);
  const hub = new LiveHub();
  const rooms = new RoomEngine(config, hub, config.textSeed);
  const app: Server = { config, store, mail, hub, rooms, ready: false };
  hub.onConnectionClosed = (connection) => {
    rooms.connectionClosed(undefined, connection.token ?? '');
  };

  const server = http.createServer((req, res) => {
    void handle(app, req, res).catch((error) => {
      if (!res.headersSent) json(res, 500, { error: 'internal' });
      res.end();
      console.error('request failed', error);
    });
  });

  server.listen(config.port, '0.0.0.0');

  // Keep trying the database until it answers, then apply the schema.
  const connect = async (): Promise<void> => {
    try {
      await applySchema(pool);
      app.ready = true;
      mail.start();
      setInterval(() => { void mail.flushOnce(); }, config.mailRetrySeconds * 1000).unref();
    } catch {
      setTimeout(connect, 2000).unref();
    }
  };
  void connect();

  return { server, app };
}

// Passwords: scrypt with a random salt, stored as salt:hash.

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (salt === undefined || hash === undefined) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// Request bodies, with the published limits and error precedence.

async function readBody(req: http.IncomingMessage, limit: number): Promise<RequestBody | 'too_large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return 'too_large';
    chunks.push(chunk as Buffer);
  }
  return { raw: Buffer.concat(chunks), json: null };
}

function parseJson(raw: Buffer): unknown | 'invalid_json' {
  if (raw.length === 0) return 'invalid_json';
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return 'invalid_json';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function handle(app: Server, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${app.config.port}`);
  const path = url.pathname;
  const query = url.searchParams;

  if (path.startsWith('/api/')) {
    await handleApi(app, req, res, method, path, query);
    return;
  }

  // Same origin only, for state-changing requests.
  if (method !== 'GET' && method !== 'HEAD' && path !== '/api/health') {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      if (path.startsWith('/api/') || path.startsWith('/live')) {
        json(res, 403, { error: 'cross_origin' });
        return;
      }
    }
  }

  const cookies = readCookies(req);
  const sessionToken = cookies['strikeproof-session'] ?? null;
  const typist = sessionToken === null ? null : await app.store.sessionTypist(sessionToken);

  await serveStatic(res, path, PUBLIC_DIR, { typistName: typist?.name ?? null, typistVerified: typist?.verified ?? null, sessionToken });
  void method;
  void query;
}

async function handleApi(app: Server, req: http.IncomingMessage, res: http.ServerResponse, method: string, path: string, query: URLSearchParams): Promise<void> {
  const cookies = readCookies(req);
  const sessionToken = cookies['strikeproof-session'] ?? null;
  const typist = sessionToken === null ? null : await app.store.sessionTypist(sessionToken);
  const ctx: Ctx = {
    req, res, method, path, query, params: {}, body: null,
    cookies, session: sessionToken === null ? null : { token: sessionToken, typistId: typist?.id ?? '' },
  };

  const respond = (status: number, payload: unknown, headers?: Record<string, string>): void => json(res, status, payload, headers);

  try {
    // Health and config first: they never need a session.
    if (method === 'GET' && path === '/api/health') {
      if (!app.ready) { respond(503, { status: 'starting' }); return; }
      respond(200, { status: 'ok' });
      return;
    }
    if (method === 'GET' && path === '/api/config') {
      respond(200, {
        focusWarningMs: app.config.focusWarningMs,
        maxExtraLetters: app.config.maxExtraLetters,
        raceCountdownSeconds: app.config.raceCountdownSeconds,
        raceRejoinSeconds: app.config.raceRejoinSeconds,
      });
      return;
    }

    // Bodies, with the published precedence.
    let body: unknown = null;
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      if (path !== '/api/session' || method !== 'DELETE') {
        const contentType = req.headers['content-type'] ?? '';
        if (method === 'POST' || method === 'PUT') {
          if (!contentType.includes('application/json')) { respond(415, { error: 'unsupported_media_type' }); return; }
        }
        const raw = await readBody(req, app.config.bodyByteLimit);
        if (raw === 'too_large') { respond(413, { error: 'body_too_large', limit: app.config.bodyByteLimit }); return; }
        const parsed = parseJson(raw.raw);
        if (parsed === 'invalid_json') { respond(400, { error: 'invalid_json' }); return; }
        body = parsed;
        ctx.body = { raw: raw.raw, json: parsed };
      }
    }

    // Cross-origin state-changing requests.
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      respond(403, { error: 'cross_origin' });
      return;
    }

    await route(app, ctx, typist, respond, body);
  } catch (error) {
    if (error instanceof ApiError) { respond(error.status, error.payload); return; }
    console.error('api failure', error);
    if (!res.headersSent) respond(500, { error: 'internal' });
  }
}

type Respond = (status: number, payload: unknown, headers?: Record<string, string>) => void;

const DEFAULT_SETTINGS: SettingsRow = { theme: 'sand', caret: 'line', smoothCaret: true, fontSize: 1.5, blindMode: false, quickRestart: 'tab' };

const TIME_LENGTHS = [15, 30, 60, 120];
const WORDS_LENGTHS = [10, 25, 50, 100];

function ticketLengthOf(mode: string, length: unknown): { ok: true; length: number | string | null } | { ok: false } {
  if (mode === 'time') {
    if (typeof length === 'number' && TIME_LENGTHS.includes(length)) return { ok: true, length };
    return { ok: false };
  }
  if (mode === 'words') {
    if (typeof length === 'number' && WORDS_LENGTHS.includes(length)) return { ok: true, length };
    return { ok: false };
  }
  if (mode === 'quote') {
    if (typeof length === 'string' && ['short', 'medium', 'long', 'all'].includes(length)) return { ok: true, length };
    return { ok: false };
  }
  if (mode === 'custom') {
    if (length === null) return { ok: true, length: null };
    return { ok: false };
  }
  return { ok: false };
}

function requireTypist(ctx: Ctx, typist: TypistInfo | null): TypistInfo {
  if (typist === null) throw new ApiError(401, { error: 'unauthenticated' });
  void ctx;
  return typist;
}

function requireVerified(ctx: Ctx, typist: TypistInfo | null): TypistInfo {
  const t = requireTypist(ctx, typist);
  if (!t.verified) throw new ApiError(403, { error: 'email_unverified' });
  return t;
}

interface TypistInfo { id: string; name: string; email: string; verified: boolean }

async function route(app: Server, ctx: Ctx, typist: TypistInfo | null, respond: Respond, body: unknown): Promise<void> {
  const { method, path, query, res } = ctx;
  const config = app.config;
  const store = app.store;
  const me = typist === null ? null : { id: typist.id, name: typist.name, verified: typist.verified };

  const signOut = (): void => {
    if (ctx.session !== null) {
      void store.deleteSession(ctx.session.token).then(() => {
        app.hub.closeToken(ctx.session?.token ?? '');
      });
    }
  };

  // Sign-up.
  if (method === 'POST' && path === '/api/signup') {
    if (!isObject(body)) { respond(422, { error: 'invalid_fields', errors: {} }); return; }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const errors: Record<string, string> = {};
    if (name.length < 1 || name.length > 24) errors.name = 'Display name must be 1 to 24 characters.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Enter a valid email address.';
    if (password.length < 10) errors.password = 'Password must be at least 10 characters.';
    if (Object.keys(errors).length > 0) { respond(422, { error: 'invalid_fields', errors }); return; }
    const existing = await store.typistByEmail(email);
    if (existing !== null) { respond(409, { error: 'email_taken' }); return; }
    const created = await store.createTypist(email, name, hashPassword(password), false);
    const token = randomToken();
    await store.createSession(created.id, token);
    const verifyToken = randomToken();
    await store.createVerifyToken(created.id, verifyToken, new Date(Date.now() + config.verifyTtlSeconds * 1000));
    const message = verificationBody(config.publicUrl, verifyToken);
    const mailStatus = await app.mail.send(email, message.subject, message.body);
    respond(201, { id: created.id, email, verified: false, mail: mailStatus }, { 'set-cookie': cookieHeader('strikeproof-session', token, 60 * 60 * 24 * 30) });
    return;
  }

  // Verify.
  if (method === 'POST' && path === '/api/verify') {
    if (!isObject(body) || typeof body.token !== 'string') { respond(410, { error: 'link_expired' }); return; }
    const result = await store.consumeVerifyToken(body.token);
    if (result !== 'ok') { respond(410, { error: 'link_expired' }); return; }
    const r = await store.query<{ typist_id: string }>('SELECT typist_id FROM verify_tokens WHERE token = $1', [body.token]);
    const typistId = r.rows[0]?.typist_id;
    if (typistId === undefined) { respond(410, { error: 'link_expired' }); return; }
    await store.updateTypist(typistId, { verified: true });
    respond(200, { verified: true });
    return;
  }

  // Sign-in, with the parallel-counted failure limit.
  if (method === 'POST' && path === '/api/session') {
    if (!isObject(body) || typeof body.email !== 'string' || typeof body.password !== 'string') {
      respond(401, { error: 'invalid_credentials' });
      return;
    }
    const email = body.email.trim();
    const now = new Date();
    await store.pruneSignInFailures(now);
    const found = await store.typistByEmail(email);
    if (found === null || !verifyPassword(body.password, found.passwordHash)) {
      // One locked statement counts the failure and decides the limit at once,
      // so parallel wrong-password attempts cannot slip past it.
      const outcome = await store.countFailedSignIn(email, config.signAttemptWindowSeconds, config.signAttemptMaxFailures, now);
      if (!outcome.counted) {
        const oldest = await store.oldestRecentFailure(email, config.signAttemptWindowSeconds, now);
        const remaining = oldest === null ? 1 : Math.ceil((oldest.getTime() + config.signAttemptWindowSeconds * 1000 - now.getTime()) / 1000);
        respond(429, { error: 'too_many_attempts', retryAfter: Math.max(1, remaining) });
        return;
      }
      respond(401, { error: 'invalid_credentials' });
      return;
    }
    const failures = await store.currentSignInFailures(email, config.signAttemptWindowSeconds, now);
    if (failures >= config.signAttemptMaxFailures) {
      const oldest = await store.oldestRecentFailure(email, config.signAttemptWindowSeconds, now);
      const remaining = oldest === null ? 1 : Math.ceil((oldest.getTime() + config.signAttemptWindowSeconds * 1000 - now.getTime()) / 1000);
      respond(429, { error: 'too_many_attempts', retryAfter: Math.max(1, remaining) });
      return;
    }
    const token = randomToken();
    await store.createSession(found.id, token);
    respond(200, { id: found.id, name: found.name, verified: found.verified }, { 'set-cookie': cookieHeader('strikeproof-session', token, 60 * 60 * 24 * 30) });
    return;
  }

  if (method === 'DELETE' && path === '/api/session') {
    signOut();
    empty(res, 204, { 'set-cookie': clearCookie('strikeproof-session') });
    return;
  }

  if (method === 'GET' && path === '/api/me') {
    const t = requireTypist(ctx, typist);
    respond(200, { id: t.id, name: t.name, verified: t.verified });
    return;
  }

  if (method === 'POST' && path === '/api/password-reset') {
    if (!isObject(body) || typeof body.email !== 'string') { respond(202, { status: 'accepted' }); return; }
    const email = body.email.trim();
    const found = await store.typistByEmail(email);
    if (found !== null) {
      const token = randomToken();
      await store.createResetToken(found.id, token, new Date(Date.now() + config.resetTtlSeconds * 1000));
      const message = resetBody(config.publicUrl, token);
      await app.mail.send(email, message.subject, message.body);
    }
    respond(202, { status: 'accepted' });
    return;
  }

  if (method === 'POST' && path === '/api/password-reset/confirm') {
    if (!isObject(body) || typeof body.token !== 'string' || typeof body.password !== 'string') {
      respond(410, { error: 'link_expired' });
      return;
    }
    const errors: Record<string, string> = {};
    if (body.password.length < 10) errors.password = 'Password must be at least 10 characters.';
    const result = await store.consumeResetToken(body.token);
    if (result !== 'ok') { respond(410, { error: 'link_expired' }); return; }
    const r = await store.query<{ typist_id: string }>('SELECT typist_id FROM reset_tokens WHERE token = $1', [body.token]);
    const typistId = r.rows[0]?.typist_id;
    if (typistId === undefined) { respond(410, { error: 'link_expired' }); return; }
    const tokens = await store.sessionTokensForTypist(typistId);
    await store.updateTypist(typistId, { passwordHash: hashPassword(body.password) });
    await store.deleteSessionsForTypist(typistId);
    for (const token of tokens) app.hub.closeToken(token);
    if (Object.keys(errors).length > 0) { respond(422, { error: 'invalid_fields', errors }); return; }
    respond(200, { status: 'changed' }, { 'set-cookie': clearCookie('strikeproof-session') });
    return;
  }

  // Settings.
  if (method === 'GET' && path === '/api/settings') {
    const t = requireTypist(ctx, typist);
    const settings = await store.settingsFor(t.id, DEFAULT_SETTINGS);
    respond(200, settings);
    return;
  }
  if (method === 'PUT' && path === '/api/settings') {
    const t = requireTypist(ctx, typist);
    const parsed = parseSettings(body);
    if (parsed === null) { respond(422, { error: 'invalid_fields' }); return; }
    await store.saveSettings(t.id, parsed);
    respond(200, parsed);
    return;
  }

  // Tickets.
  if (method === 'POST' && path === '/api/tickets') {
    if (!isObject(body)) { respond(422, { error: 'invalid_ticket_request' }); return; }
    const mode = typeof body.mode === 'string' ? body.mode : '';
    if (!['time', 'words', 'quote', 'custom'].includes(mode)) { respond(422, { error: 'invalid_ticket_request' }); return; }
    const lengthCheck = ticketLengthOf(mode, body.length);
    if (!lengthCheck.ok) { respond(422, { error: 'invalid_ticket_request' }); return; }
    const punctuation = mode === 'time' || mode === 'words' ? body.punctuation === true : false;
    const numbers = mode === 'time' || mode === 'words' ? body.numbers === true : false;
    let words: string[] | null = null;
    let quoteId: string | null = null;
    let customText: string | null = null;
    if (mode === 'custom') {
      if (typeof body.text !== 'string' || body.text.trim() === '') { respond(422, { error: 'custom_text_empty' }); return; }
      const normalized = normalizeCustomText(body.text);
      if (countCodePoints(normalized) > config.customMaxCharacters || countWords(normalized) > config.customMaxWords) {
        respond(422, { error: 'custom_text_too_long' });
        return;
      }
      customText = normalized;
      words = normalized.split(' ');
    }
    const sequence = await store.nextSequence();
    const seed = seedFor(config.textSeed, sequence);

    // Grading fixed text, if queued for this typist or a guest.
    const target = typist === null ? 'guest' : `typist:${typist.email}`;
    const fixed = app.rooms.takeFixedText(target);
    if (fixed !== null && mode !== 'quote') {
      words = fixed.words;
      quoteId = fixed.quoteId;
      const ticket = await issueTicket(app, typist, mode, lengthCheck.length, false, false, fixed.words, null, fixed.quoteId);
      respond(201, ticket);
      return;
    }

    if (mode === 'quote') {
      const group = (typeof lengthCheck.length === 'string' ? lengthCheck.length : 'short') as 'short' | 'medium' | 'long' | 'all';
      const picked = quotePick(seed, group);
      words = picked.words;
      quoteId = picked.quoteId;
    } else if (mode === 'time') {
      words = generateWords(seed, timeWordCount(Number(lengthCheck.length)), punctuation, numbers);
    } else if (mode === 'words') {
      words = generateWords(seed, Number(lengthCheck.length), punctuation, numbers);
    }
    void customText;
    const ticket = await issueTicket(app, typist, mode, lengthCheck.length, punctuation, numbers, words ?? [], seed, quoteId);
    respond(201, ticket);
    return;
  }

  // Runs.
  if (method === 'POST' && path === '/api/runs') {
    const t = requireVerified(ctx, typist);
    const submission = await submitRun(app, ctx, t, body);
    respond(submission.status, submission.body);
    return;
  }

  const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
  if (method === 'GET' && runMatch !== null) {
    const t = requireTypist(ctx, typist);
    const run = await store.runById(runMatch[1]);
    if (run === null || run.typistId !== t.id) { respond(404, { error: 'not_found' }); return; }
    respond(200, runResponse(run));
    return;
  }

  if (method === 'GET' && path === '/api/history') {
    const t = requireTypist(ctx, typist);
    const mode = query.get('mode');
    const length = query.get('length');
    const verdict = query.get('verdict');
    const page = Math.max(1, Number(query.get('page') ?? '1') || 1);
    const result = await store.history(
      t.id,
      mode !== null && mode !== '' && ['time', 'words', 'quote', 'custom'].includes(mode) ? mode : null,
      length !== null && length !== '' ? length : null,
      verdict === 'counted' ? 'counted' : verdict === 'not_counted' ? 'not_counted' : null,
      page, config.historyPageSize);
    const lengths = await store.historyLengths(t.id, mode ?? null);
    respond(200, {
      runs: result.rows.map((row) => ({
        runId: row.runId,
        finishedAt: row.finishedAt.toISOString(),
        mode: row.mode,
        length: row.length,
        speed: row.speed,
        raw: row.raw,
        accuracy: row.accuracy,
        consistency: row.consistency,
        verdict: row.verdict,
      })),
      more: result.more,
      lengths,
    });
    return;
  }

  if (method === 'GET' && path === '/api/account') {
    const t = requireTypist(ctx, typist);
    const full = await store.typistById(t.id);
    const bests = await store.personalBests(t.id);
    const counted = await store.testsCounted(t.id);
    const rows = bests.map((row) => ({
      mode: row.mode,
      length: row.length,
      punctuation: row.punctuation,
      numbers: row.numbers,
      speed: row.speed,
      accuracy: row.accuracy,
      finishedAt: row.finishedAt.toISOString(),
      runId: row.runId,
    })).sort(compareBestRows);
    respond(200, {
      name: full?.name ?? t.name,
      email: full?.email ?? '',
      verified: t.verified,
      testsCounted: counted,
      personalBests: rows,
    });
    return;
  }

  if (method === 'GET' && path === '/api/boards') {
    const board = query.get('board');
    const length = Number(query.get('length') ?? '');
    if ((board !== 'daily' && board !== 'alltime') || (length !== 15 && length !== 60)) {
      respond(422, { error: 'invalid_board' });
      return;
    }
    const rows = await store.board(board, length, config.publicBoardRows);
    respond(200, {
      rows: rows.map((row) => ({
        rank: row.rank,
        name: row.name,
        speed: row.speed,
        accuracy: row.accuracy,
        finishedAt: row.finishedAt.toISOString(),
      })),
    });
    return;
  }

  // Rooms.
  if (method === 'POST' && path === '/api/rooms') {
    const t = requireTypist(ctx, typist);
    const snapshot = app.rooms.createRoom(t.id, t.name, ctx.session?.token ?? '');
    respond(201, { code: snapshot.code });
    return;
  }
  const roomMatch = path.match(/^\/api\/rooms\/([^/]+)$/);
  if (method === 'GET' && roomMatch !== null) {
    const t = requireTypist(ctx, typist);
    const room = app.rooms.room(roomMatch[1]);
    if (room === undefined) { respond(404, { error: 'room_not_found' }); return; }
    if (!room.racers.has(t.id)) { respond(404, { error: 'room_not_found' }); return; }
    respond(200, roomApiResponse(app.rooms.snapshot(room), t.id, app.rooms.racerLog(room.code, t.id)));
    return;
  }
  const joinMatch = path.match(/^\/api\/rooms\/([^/]+)\/join$/);
  if (method === 'POST' && joinMatch !== null) {
    const t = requireTypist(ctx, typist);
    const result = app.rooms.join(joinMatch[1], t.id, t.name, ctx.session?.token ?? '');
    if (!result.ok) { respond(409, { error: result.error }); return; }
    respond(200, { code: result.room.code, rejoined: result.rejoined });
    return;
  }
  const startMatch = path.match(/^\/api\/rooms\/([^/]+)\/start$/);
  if (method === 'POST' && startMatch !== null) {
    const t = requireTypist(ctx, typist);
    const result = app.rooms.start(startMatch[1], t.id);
    if (!result.ok) {
      const status = result.error === 'room_not_found' ? 404 : result.error === 'not_host' ? 403 : 409;
      respond(status, { error: result.error });
      return;
    }
    respond(200, { state: 'countdown' });
    return;
  }
  const finishMatch = path.match(/^\/api\/rooms\/([^/]+)\/finish$/);
  if (method === 'POST' && finishMatch !== null) {
    const t = requireTypist(ctx, typist);
    const room = app.rooms.room(finishMatch[1]);
    if (room === undefined || !room.racers.has(t.id)) { respond(404, { error: 'room_not_found' }); return; }
    const proofKey = ctx.body === null ? null : await sha256Hex(new Uint8Array(ctx.body.raw));
    const log = parseLog(body);
    if (log === null) { respond(422, { error: 'invalid_log', verdict: 'not_counted', proofKey: proofKey ?? undefined }); return; }
    const result = app.rooms.finish(room.code, t.id, log);
    if (!result.ok) {
      if (result.error === 'room_not_found') { respond(404, { error: 'room_not_found' }); return; }
      if (result.error === 'race_over') { respond(409, { error: 'race_over' }); return; }
      respond(422, { error: result.error, proofKey });
      return;
    }
    respond(200, { place: result.place, verdict: 'counted', speed: result.speed, accuracy: result.accuracy, proofKey });
    return;
  }
  const typedMatch = path.match(/^\/api\/rooms\/([^/]+)\/typed$/);
  if (method === 'POST' && typedMatch !== null) {
    const t = requireTypist(ctx, typist);
    const room = app.rooms.room(typedMatch[1]);
    if (room === undefined || !room.racers.has(t.id)) { respond(404, { error: 'room_not_found' }); return; }
    const log = parseLog(body);
    if (log === null) { respond(422, { error: 'invalid_log' }); return; }
    app.rooms.typed(room.code, t.id, log);
    respond(200, { ok: true });
    return;
  }

  // Live channel.
  if (method === 'GET' && path === '/api/live') {
    const topics = (query.get('topics') ?? '').split(',').filter((t) => t !== '');
    const roomCode = query.get('room');
    if (roomCode !== null) topics.push(`room:${roomCode.replace(/[-\s]/g, '').toUpperCase()}`);
    app.hub.open(ctx.res, ctx.session?.token ?? null, topics);
    if (ctx.session !== null && roomCode !== null) {
      app.rooms.watch(roomCode, ctx.session.typistId, ctx.session.token);
    }
    return;
  }

  // Grading routes.
  const gradingKey = ctx.req.headers['x-grading-key'];
  if ((path === '/api/grading/setup' || path === '/api/grading/next-text') && (gradingKey === undefined || gradingKey !== config.gradingKey)) {
    respond(404, { error: 'not_found' });
    return;
  }
  if (method === 'POST' && path === '/api/grading/setup') {
    if (!isObject(body) || !Array.isArray(body.typists) || !Array.isArray(body.runs)) { respond(422, { error: 'invalid_fields' }); return; }
    const created: { email: string; id: string }[] = [];
    const typists: { email: string; name: string; password: string; verified: boolean; passwordHash: string }[] = [];
    for (const entry of body.typists) {
      if (!isObject(entry)) continue;
      const email = typeof entry.email === 'string' ? entry.email : '';
      const name = typeof entry.name === 'string' ? entry.name : email;
      const password = typeof entry.password === 'string' ? entry.password : 'grading-password-10';
      const verified = entry.verified === true;
      if (email === '') continue;
      typists.push({ email, name, password, verified, passwordHash: hashPassword(password) });
    }
    const runs: { typistId: string; mode: string; length: number; punctuation: boolean; numbers: boolean; speed: number; raw: number; accuracy: number; consistency: number; finishedAt: Date }[] = [];
    // Insert typists first, then map emails to ids for the runs.
    for (const t of typists) {
      const existing = await store.typistByEmail(t.email);
      if (existing === null) {
        const created2 = await store.createTypist(t.email, t.name, t.passwordHash, t.verified);
        created.push({ email: t.email, id: created2.id });
      } else {
        await store.updateTypist(existing.id, { name: t.name, passwordHash: t.passwordHash, verified: t.verified });
        created.push({ email: t.email, id: existing.id });
      }
    }
    const byEmail = new Map(created.map((x) => [x.email.toLowerCase(), x.id]));
    for (const run of body.runs) {
      if (!isObject(run)) continue;
      const email = typeof run.email === 'string' ? run.email : '';
      const typistId = byEmail.get(email.toLowerCase());
      if (typistId === undefined) continue;
      const mode = typeof run.mode === 'string' ? run.mode : 'time';
      const length = typeof run.length === 'number' ? run.length : 15;
      const finishedAt = typeof run.finishedAt === 'string' ? new Date(run.finishedAt) : new Date();
      runs.push({
        typistId, mode, length,
        punctuation: run.punctuation === true,
        numbers: run.numbers === true,
        speed: typeof run.speed === 'number' ? run.speed : 0,
        raw: typeof run.raw === 'number' ? run.raw : 0,
        accuracy: typeof run.accuracy === 'number' ? run.accuracy : 0,
        consistency: typeof run.consistency === 'number' ? run.consistency : 0,
        finishedAt: Number.isNaN(finishedAt.getTime()) ? new Date() : finishedAt,
      });
    }
    await store.gradingSetup(typists, runs);
    respond(201, { typists: created });
    return;
  }
  if (method === 'POST' && path === '/api/grading/next-text') {
    if (!isObject(body) || typeof body.target !== 'string') { respond(422, { error: 'invalid_fields' }); return; }
    const target = body.target;
    if (typeof body.quoteId === 'string' && QUOTES.some((q) => q.id === body.quoteId)) {
      const quote = QUOTES.find((q) => q.id === body.quoteId);
      if (quote === undefined) { respond(422, { error: 'invalid_fields' }); return; }
      app.rooms.setFixedText(target, quote.text.split(' '), quote.id);
      respond(200, { queued: true });
      return;
    }
    if (Array.isArray(body.words)) {
      const words = body.words.filter((w): w is string => typeof w === 'string');
      app.rooms.setFixedText(target, words);
      respond(200, { queued: true });
      return;
    }
    respond(422, { error: 'invalid_fields' });
    return;
  }

  // Unknown API path.
  respond(404, { error: 'not_found' });
}

export function parseSettings(body: unknown): SettingsRow | null {
  if (!isObject(body)) return null;
  const themes = ['sand', 'cobalt', 'carbon', 'ledger'];
  const carets = ['line', 'block', 'underline', 'off'];
  const fonts = [1, 1.5, 2, 3];
  const quick = ['tab', 'enter'];
  if (typeof body.theme !== 'string' || !themes.includes(body.theme)) return null;
  if (typeof body.caret !== 'string' || !carets.includes(body.caret)) return null;
  if (typeof body.smoothCaret !== 'boolean') return null;
  if (typeof body.fontSize !== 'number' || !fonts.includes(body.fontSize)) return null;
  if (typeof body.blindMode !== 'boolean') return null;
  if (typeof body.quickRestart !== 'string' || !quick.includes(body.quickRestart)) return null;
  return {
    theme: body.theme,
    caret: body.caret,
    smoothCaret: body.smoothCaret,
    fontSize: body.fontSize,
    blindMode: body.blindMode,
    quickRestart: body.quickRestart,
  };
}

function parseLog(body: unknown): LogEntry[] | null {
  if (!isObject(body) || !Array.isArray(body.log)) return null;
  return body.log as LogEntry[];
}

function compareBestRows(a: { mode: string; length: number | null; punctuation: boolean; numbers: boolean }, b: { mode: string; length: number | null; punctuation: boolean; numbers: boolean }): number {
  const modes = ['time', 'words', 'quote', 'custom'];
  const am = modes.indexOf(a.mode);
  const bm = modes.indexOf(b.mode);
  if (am !== bm) return am - bm;
  const al = a.length ?? 0;
  const bl = b.length ?? 0;
  if (al !== bl) return al - bl;
  if (a.punctuation !== b.punctuation) return a.punctuation ? 1 : -1;
  if (a.numbers !== b.numbers) return a.numbers ? 1 : -1;
  return 0;
}

async function issueTicket(app: Server, typist: TypistInfo | null, mode: string, length: number | string | null, punctuation: boolean, numbers: boolean, words: string[], seed: number | null, quoteId: string | null): Promise<Record<string, unknown>> {
  const ticketId = randomUuid();
  const expiresAt = new Date(Date.now() + app.config.ticketTtlSeconds * 1000);
  const row: TicketRow = {
    ticketId,
    typistId: typist?.id ?? null,
    mode: mode as TicketRow['mode'],
    length: typeof length === 'number' ? length : null,
    punctuation,
    numbers,
    words,
    seed,
    quoteId,
    expiresAt,
    submittedRunId: null,
  };
  await app.store.insertTicket(row);
  return {
    ticketId,
    seed,
    words,
    quoteId,
    expiresAt: expiresAt.toISOString(),
  };
}

function runResponse(run: RunRow): Record<string, unknown> {
  const base: Record<string, unknown> = {
    runId: run.runId,
    mode: run.mode,
    length: run.length,
    punctuation: run.punctuation,
    numbers: run.numbers,
    quoteId: run.quoteId,
    words: run.words,
    log: run.log,
    duration: run.durationMs,
    speed: run.speed,
    raw: run.raw,
    accuracy: run.accuracy,
    consistency: run.consistency,
    characters: run.characters,
    verdict: run.verdict,
    reason: run.reason,
    finishedAt: run.finishedAt.toISOString(),
    proofKey: run.proofKey,
  };
  if (run.verdict === 'counted') {
    base.errorsByKey = run.errorsByKey;
    base.perSecond = run.perSecond;
  } else {
    base.errorsByKey = null;
    base.perSecond = null;
  }
  return base;
}

function roomApiResponse(snapshot: { code: string; state: string; racers: { name: string; host: boolean; left: boolean; progress: number; place: number | null; speed: number | null; accuracy: number | null }[]; words: string[] | null; elapsedMs: number | null }, typistId: string, log: LogEntry[]): Record<string, unknown> {
  return {
    code: snapshot.code,
    state: snapshot.state,
    racers: snapshot.racers.map((r) => ({ name: r.name, host: r.host, left: r.left, progress: r.progress, place: r.place, speed: r.speed, accuracy: r.accuracy })),
    words: snapshot.words,
    elapsedMs: snapshot.elapsedMs,
    typistId,
    log,
  };
}

// Run submission: the published check order, one visible place.

async function submitRun(app: Server, ctx: Ctx, typist: TypistInfo, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const config = app.config;
  const store = app.store;
  const raw = ctx.body === null ? Buffer.from(JSON.stringify(body ?? {})) : ctx.body.raw;
  const proofKey = await sha256Hex(new Uint8Array(raw));

  // 1. log_too_long, before any replay and without storing.
  const logValue = isObject(body) ? body.log : undefined;
  if (Array.isArray(logValue) && logValue.length > config.maxLogEvents) {
    return { status: 413, body: { error: 'log_too_long', limit: config.maxLogEvents } };
  }
  if (Array.isArray(logValue)) {
    for (const entry of logValue) {
      if (isObject(entry) && typeof entry.t === 'number' && entry.t > config.maxTestMs) {
        return { status: 413, body: { error: 'log_too_long', limit: config.maxLogEvents } };
      }
    }
  }

  const ticketId = isObject(body) && typeof body.ticketId === 'string' ? body.ticketId : '';
  const ticket = ticketId === '' ? null : await store.ticketById(ticketId);
  // 2. ticket_not_found
  if (ticket === null || ticket.typistId === null || ticket.typistId !== typist.id) {
    return { status: 404, body: { error: 'ticket_not_found' } };
  }
  // 3. one ticket, one run: an already-submitted ticket returns its first response.
  const existing = await store.storedResponse(ticketId);
  if (existing !== null) return existing;

  // 4. ticket_expired
  if (ticket.expiresAt.getTime() <= Date.now()) {
    return { status: 410, body: { error: 'ticket_expired' } };
  }

  // 5. The 422 checks, in order.
  const log = logValue;
  const invalidLog = (): boolean => {
    if (!Array.isArray(log)) return true;
    for (const entry of log) {
      if (!isObject(entry)) return true;
      if (typeof entry.k !== 'string' || !isLoggedKey(entry.k)) return true;
      if (!Number.isInteger(entry.t)) return true;
      const keys = Object.keys(entry);
      if (keys.length !== 2 || keys[0] !== 'k' || keys[1] !== 't') return true;
    }
    if (Array.isArray(log) && log.length > 0) {
      const first = log[0];
      if (isObject(first) && typeof first.t === 'number' && first.t !== 0) return true;
    }
    return false;
  };
  if (invalidLog()) {
    const stored = await storeNotCounted(app, ticket, typist.id, raw, proofKey, 'invalid_log', body);
    return { status: 422, body: stored };
  }
  const entries = log as LogEntry[];
  const textValue = isObject(body) ? body.text : undefined;
  if (!Array.isArray(textValue) || textValue.length !== ticket.words.length || !textValue.every((w, i) => w === ticket.words[i])) {
    const stored = await storeNotCounted(app, ticket, typist.id, raw, proofKey, 'wrong_text', body);
    return { status: 422, body: stored };
  }
  let fastCount = 0;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].t - entries[i - 1].t < config.fastIntervalMs) fastCount++;
  }
  const gapCount = Math.max(0, entries.length - 1);
  const outOfOrder = entries.some((entry, i) => i > 0 && entry.t < entries[i - 1].t);
  if (outOfOrder || (gapCount > 0 && (fastCount / gapCount) > 0.3)) {
    const stored = await storeNotCounted(app, ticket, typist.id, raw, proofKey, 'impossible_interval', body);
    return { status: 422, body: stored };
  }
  const durationValue = isObject(body) && typeof body.duration === 'number' ? body.duration : undefined;
  const opts = { maxExtraLetters: config.maxExtraLetters, timeLimitMs: ticket.mode === 'time' ? Number(ticket.length) * 1000 : null };
  const replay = replayLog(ticket.words, entries, opts);
  const expectedDuration = ticket.mode === 'time' ? Number(ticket.length) * 1000 : replay.durationMs;
  const tooLate = ticket.mode === 'time' && entries.some((entry) => entry.t >= expectedDuration);
  if (ticket.mode === 'time') {
    if (durationValue !== expectedDuration || tooLate) {
      const stored = await storeNotCounted(app, ticket, typist.id, raw, proofKey, 'duration_mismatch', body);
      return { status: 422, body: stored };
    }
  } else {
    if (!replay.score.ended || durationValue !== replay.durationMs) {
      const stored = await storeNotCounted(app, ticket, typist.id, raw, proofKey, 'duration_mismatch', body);
      return { status: 422, body: stored };
    }
  }
  // Entries after the ending keystroke.
  if (ticket.mode !== 'time') {
    const endingIndex = entries.findIndex((_entry, i) => replayLog(ticket.words, entries.slice(0, i + 1), opts).score.ended);
    if (endingIndex !== -1 && entries.slice(endingIndex + 1).length > 0) {
      const stored = await storeNotCounted(app, ticket, typist.id, raw, proofKey, 'duration_mismatch', body);
      return { status: 422, body: stored };
    }
  }

  // 5.5 replay_mismatch
  const submittedSpeed = isObject(body) && typeof body.speed === 'number' ? body.speed : NaN;
  const submittedRaw = isObject(body) && typeof body.raw === 'number' ? body.raw : NaN;
  const submittedAccuracy = isObject(body) && typeof body.accuracy === 'number' ? body.accuracy : NaN;
  const submittedConsistency = isObject(body) && typeof body.consistency === 'number' ? body.consistency : NaN;
  const chars = isObject(body) && isObject(body.characters) ? body.characters : null;
  const figures = replay.figures;
  const charsMatch = chars !== null
    && Number(chars.correct) === replay.score.characters.correct
    && Number(chars.incorrect) === replay.score.characters.incorrect
    && Number(chars.extra) === replay.score.characters.extra
    && Number(chars.missed) === replay.score.characters.missed;
  if (
    roundHalfUp2(submittedSpeed) !== roundHalfUp2(figures.speed) ||
    roundHalfUp2(submittedRaw) !== roundHalfUp2(figures.raw) ||
    roundHalfUp2(submittedAccuracy) !== roundHalfUp2(figures.accuracy) ||
    roundHalfUp2(submittedConsistency) !== roundHalfUp2(figures.consistency) ||
    !charsMatch
  ) {
    const stored = await storeNotCounted(app, ticket, typist.id, raw, proofKey, 'replay_mismatch', body);
    return { status: 422, body: stored };
  }

  // Counted: store the run in one transaction with the ticket claim.
  const best = await store.bestSpeedFor(typist.id, ticket.mode, ticket.length ?? 0, ticket.punctuation, ticket.numbers);
  const personalBest = best === null || figures.speed > best.speed
    || (figures.speed === best.speed && figures.accuracy > best.accuracy);
  const runId = randomUuid();
  const speeds = perSecondSpeeds(figures.speed, ticket.words, entries, opts, replay.durationMs);
  const perSecond = replay.perSecondRaw.map((c, i) => ({ second: c.second, speed: speeds[i] ?? figures.speed, raw: (c.keystrokes * 12000) / (Math.min(c.second * 1000, replay.durationMs) - (c.second - 1) * 1000), errors: c.errors }));
  const runRow: RunRow = {
    runId,
    typistId: typist.id,
    ticketId: ticket.ticketId,
    mode: ticket.mode,
    length: ticket.length,
    punctuation: ticket.punctuation,
    numbers: ticket.numbers,
    quoteId: ticket.quoteId,
    words: ticket.words,
    log: entries,
    verdict: 'counted',
    reason: null,
    durationMs: roundHalfUp2(replay.durationMs),
    speed: roundHalfUp2(figures.speed),
    raw: roundHalfUp2(figures.raw),
    accuracy: roundHalfUp2(figures.accuracy),
    consistency: roundHalfUp2(figures.consistency),
    characters: replay.score.characters,
    errorsByKey: replay.score.errorsByKey,
    perSecond,
    personalBest,
    finishedAt: new Date(),
    proofKey,
  };
  await store.insertRun(runRow, raw);
  const stored = await store.storedResponse(ticket.ticketId);
  if (stored !== null && stored.body.runId !== runId) return stored;

  // Board and personal-best announcements.
  const eligible = ticket.mode === 'time' && ticket.punctuation === false && ticket.numbers === false && (ticket.length === 15 || ticket.length === 60);
  if (eligible && typist.verified) {
    void refreshBoards(app, ticket.length ?? 0, typist.id);
  }
  return {
    status: 201,
    body: { runId, verdict: 'counted', personalBest, speed: runRow.speed, raw: runRow.raw, accuracy: runRow.accuracy, consistency: runRow.consistency, proofKey },
  };
}

async function storeNotCounted(app: Server, ticket: TicketRow, typistId: string, raw: Buffer, proofKey: string, reason: string, body: unknown): Promise<Record<string, unknown>> {
  const runId = randomUuid();
  const submitted = (key: string): number | null => {
    const value = isObject(body) ? (body as Record<string, unknown>)[key] : undefined;
    return typeof value === 'number' && Number.isFinite(value) ? roundHalfUp2(value) : null;
  };
  const chars = isObject(body) && isObject(body.characters) ? body.characters : null;
  const row: RunRow = {
    runId,
    typistId,
    ticketId: ticket.ticketId,
    mode: ticket.mode,
    length: ticket.length,
    punctuation: ticket.punctuation,
    numbers: ticket.numbers,
    quoteId: ticket.quoteId,
    words: ticket.words,
    log: isObject(body) ? (body as Record<string, unknown>).log ?? [] : [],
    verdict: 'not_counted',
    reason,
    durationMs: submitted('duration'),
    speed: submitted('speed'),
    raw: submitted('raw'),
    accuracy: submitted('accuracy'),
    consistency: submitted('consistency'),
    characters: chars === null ? null : {
      correct: typeof chars.correct === 'number' ? chars.correct : 0,
      incorrect: typeof chars.incorrect === 'number' ? chars.incorrect : 0,
      extra: typeof chars.extra === 'number' ? chars.extra : 0,
      missed: typeof chars.missed === 'number' ? chars.missed : 0,
    },
    errorsByKey: null,
    perSecond: null,
    personalBest: false,
    finishedAt: new Date(),
    proofKey,
  };
  await app.store.insertRun(row, raw);
  const stored = await app.store.storedResponse(ticket.ticketId);
  if (stored !== null && stored.body.runId !== runId) return stored.body;
  return { error: reason, verdict: 'not_counted', runId, proofKey };
}

async function refreshBoards(app: Server, length: number, typistId: string): Promise<void> {
  for (const board of ['daily', 'alltime'] as const) {
    const rows = await app.store.board(board, length, app.config.publicBoardRows);
    const mine = rows.find((row) => row.typistId === typistId);
    if (mine !== undefined) {
      app.hub.broadcast(boardTopic(board, length), {
        kind: 'board-change',
        payload: { rank: mine.rank, name: mine.name, speed: mine.speed, typistId },
      });
    }
  }
}


// Entry point: start the server.
if (process.argv[1] !== undefined && process.argv[1].endsWith('dist/server/main.js')) {
  void createServer();
}
