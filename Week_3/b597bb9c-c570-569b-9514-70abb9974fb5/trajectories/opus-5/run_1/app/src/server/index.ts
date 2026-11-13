/** The server: one boundary, one error shape, five services. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ApiError, isApiError } from '../domain/api-error.js';
import { config } from './config.js';
import { applySchema, query, waitForPostgres } from './db.js';
import { runExport } from './exports.js';
import {
  BODY_LIMITS,
  BODY_TYPES,
  matchPath,
  originIsOwn,
  readCookies,
  sendError,
  sendJson,
  SESSION_COOKIE,
  type BodyKind,
  type RequestContext,
  type Route,
} from './http.js';
import { closeExpiredReviewSockets, handleUpgrade } from './live.js';
import { isPagePath, sendAsset, sendHtml, shell } from './pages.js';
import { personBySession, publicPerson } from './repo/people.js';
import { upgradeProjectsStoredInSeconds } from './repo/upgrade.js';
import { rebuildCountersAtStart } from './allowance.js';
import { agencyRoutes } from './routes/agency.js';
import { captionRoutes } from './routes/captions.js';
import { commentRoutes } from './routes/comments.js';
import { cutRoutes } from './routes/cuts.js';
import { exportRoutes } from './routes/exports.js';
import { kitRoutes } from './routes/kits.js';
import { mediaRoutes } from './routes/media.js';
import { projectRoutes } from './routes/projects.js';
import { reviewRoutes } from './routes/review.js';
import { sessionRoutes } from './routes/session.js';
import { tokenRoutes } from './routes/tokens.js';
import { countRequest, RATE_WINDOW_SECONDS } from './services/cache.js';
import { enqueueMail, flushOutbox, probeMail } from './services/mail.js';
import { consumeExports, probeQueue } from './services/queue.js';
import { ensureBucket, probeStorage } from './services/storage.js';
import { databaseIsEmpty, seedDatabase, writeSeededObjects } from './seed.js';
import { timecode } from '../domain/rate.js';
import { exactRate } from '../domain/rate.js';

const routes: Route[] = [
  ...sessionRoutes,
  ...projectRoutes,
  ...captionRoutes,
  ...cutRoutes,
  ...commentRoutes,
  ...mediaRoutes,
  ...exportRoutes,
  ...kitRoutes,
  ...tokenRoutes,
  ...reviewRoutes,
  ...agencyRoutes,
];

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readBody(request: IncomingMessage, limit: number): Promise<{ body: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let answered = false;
    request.on('data', (chunk: Buffer) => {
      if (answered) return;
      total += chunk.length;
      if (total > limit) {
        answered = true;
        request.pause();
        resolve({ body: Buffer.alloc(0), tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!answered) resolve({ body: Buffer.concat(chunks), tooLarge: false });
    });
    request.on('error', (error) => {
      if (!answered) reject(error);
    });
  });
}

/** An over-limit body answers 413 and the server reads no further. */
function sendTooLarge(request: IncomingMessage, response: ServerResponse, limit: number): void {
  response.on('finish', () => request.destroy());
  sendError(response, ApiError.of('too_large', { limit }), { connection: 'close' });
}

function contentTypeMatches(kind: BodyKind, header: string | undefined): boolean {
  if (header === undefined) return false;
  const value = header.split(';')[0].trim().toLowerCase();
  if (kind === 'json') return value === 'application/json';
  if (kind === 'srt') return value === 'application/x-subrip';
  if (kind === 'octet') return value === 'application/octet-stream';
  return true;
}

async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const method = request.method ?? 'GET';

  if (!path.startsWith('/api')) {
    await servePage(request, response, path);
    return;
  }

  const candidates = routes
    .map((route) => ({ route, params: matchPath(route.path, path) }))
    .filter((candidate) => candidate.params !== null);
  if (candidates.length === 0) {
    sendError(response, ApiError.of('not_found', undefined));
    return;
  }
  const matched = candidates.find((candidate) => candidate.route.method === method);
  if (matched === undefined) {
    const allowed = [...new Set(candidates.map((candidate) => candidate.route.method))];
    if (path.startsWith('/api/v1')) {
      sendError(response, ApiError.of('method_not_allowed', undefined), { allow: 'GET' });
      return;
    }
    sendError(response, ApiError.of('method_not_allowed', undefined), { allow: allowed.join(', ') });
    return;
  }

  const kind: BodyKind = matched.route.body ?? 'none';
  const limit = BODY_LIMITS[kind];
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    sendTooLarge(request, response, limit);
    return;
  }
  const read = await readBody(request, limit);
  if (read.tooLarge) {
    sendTooLarge(request, response, limit);
    return;
  }
  if (matched.route.body !== undefined && STATE_CHANGING.has(method)) {
    if (!contentTypeMatches(kind, request.headers['content-type'])) {
      sendError(response, ApiError.of('unsupported_media_type', { expected: BODY_TYPES[kind] }));
      return;
    }
  }
  if (STATE_CHANGING.has(method) && !originIsOwn(request)) {
    sendError(response, ApiError.of('forbidden', undefined));
    return;
  }

  const context: RequestContext = {
    request,
    response,
    url,
    method,
    params: matched.params ?? {},
    body: read.body,
    signed: null,
    readToken: null,
  };

  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
  if (matched.route.auth === 'token') {
    if (bearer === null) {
      sendError(response, ApiError.of('unauthenticated', undefined));
      return;
    }
    const rows = await query<{ id: string; name: string }>(
      `select id, name from read_tokens where token = $1 and revoked_at is null`,
      [bearer[1]],
    );
    if (rows.length === 0) {
      sendError(response, ApiError.of('unauthenticated', undefined));
      return;
    }
    context.readToken = rows[0];
    const nowSeconds = Math.floor(Date.now() / 1000);
    const counted = await countRequest(rows[0].id, nowSeconds);
    if (counted.count > 30) {
      const seconds = Math.max(1, (counted.window + 1) * RATE_WINDOW_SECONDS - nowSeconds);
      sendError(response, ApiError.of('rate_limited', { seconds }), { 'retry-after': String(seconds) });
      return;
    }
    await query(`update read_tokens set last_used_at = now() where id = $1`, [rows[0].id]);
  } else if (matched.route.auth === 'session' || matched.route.auth === 'owner') {
    const sessionId = readCookies(request)[SESSION_COOKIE];
    const person = sessionId === undefined ? null : await personBySession(sessionId);
    if (person === null || sessionId === undefined) {
      sendError(response, ApiError.of('unauthenticated', undefined));
      return;
    }
    context.signed = { person: publicPerson(person), is_owner: person.is_owner, session_id: sessionId };
  }

  try {
    await matched.route.handle(context);
  } catch (error) {
    if (isApiError(error)) {
      sendError(response, error);
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendJson(response, 500, { error: 'not_found', message: 'Nothing here. It may have been removed or you may not have access.' });
  }
}

async function servePage(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  if (path !== '/' && (await sendAsset(response, path))) return;
  if (!isPagePath(path)) {
    sendHtml(response, shell('Nothing here · Gatecut', 404));
    return;
  }
  const open = path === '/sign-in' || path.startsWith('/review/');
  if (!open) {
    const sessionId = readCookies(request)[SESSION_COOKIE];
    const person = sessionId === undefined ? null : await personBySession(sessionId);
    if (person === null) {
      response.writeHead(302, { location: '/sign-in', 'cache-control': 'no-store' });
      response.end();
      return;
    }
  }
  sendHtml(response, shell('Gatecut'));
}

/** Mail windows: at a window's end one grouped message goes to that person. */
async function sendGroupedMail(): Promise<void> {
  const due = await query<{ person_id: string; project_id: string }>(
    `select distinct person_id, project_id from mention_notices where sent = false and window_ends_at <= now()`,
  );
  for (const group of due) {
    const notices = await query<{ id: number; author_name: string; frame: number; body: string }>(
      `select id, author_name, frame, body from mention_notices
       where person_id = $1 and project_id = $2 and sent = false and window_ends_at <= now() order by created_at`,
      [group.person_id, group.project_id],
    );
    if (notices.length === 0) continue;
    const person = await query<{ email: string }>(`select email from people where id = $1`, [group.person_id]);
    const project = await query<{ title: string; frame_rate: string }>(
      `select title, frame_rate from projects where id = $1`,
      [group.project_id],
    );
    if (person.length === 0 || project.length === 0) continue;
    const rate = exactRate(project[0].frame_rate as never);
    const lines = notices.map((notice) => `${notice.author_name} at ${timecode(notice.frame, rate)}: ${notice.body}`);
    await enqueueMail(
      person[0].email,
      `Gatecut · ${project[0].title} · notes for you (${notices.length})`,
      lines.join('\n'),
    );
    await query(`update mention_notices set sent = true where id = any($1::bigint[])`, [notices.map((notice) => notice.id)]);
  }
}

async function boot(): Promise<void> {
  await waitForPostgres();
  await applySchema();
  if (await databaseIsEmpty()) await seedDatabase();
  await upgradeProjectsStoredInSeconds();
  try {
    await rebuildCountersAtStart();
  } catch (error) {
    process.stderr.write(`counters not ready: ${String(error)}\n`);
  }

  const server = createServer((request, response) => {
    void dispatch(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'not_found', message: 'Nothing here. It may have been removed or you may not have access.' });
    });
  });
  server.on('upgrade', (request, socket, head) => {
    void handleUpgrade(request, socket as never, head);
  });
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`gatecut listening on ${config.port}\n`);
  });

  void withStorageWhenReady();
  void consumeExports(runExport).catch(() => undefined);
  setInterval(() => {
    void probeQueue().then((up) => (up ? consumeExports(runExport).catch(() => undefined) : undefined));
  }, 5000);
  setInterval(() => {
    void flushOutbox().catch(() => undefined);
    void probeMail().catch(() => undefined);
  }, Math.max(1, config.outboxRetrySeconds) * 1000);
  setInterval(() => void sendGroupedMail().catch(() => undefined), 1000);
  setInterval(() => void closeExpiredReviewSockets().catch(() => undefined), 1000);
}

async function withStorageWhenReady(): Promise<void> {
  for (;;) {
    try {
      await ensureBucket();
      await writeSeededObjects();
      return;
    } catch {
      if (await probeStorage()) {
        try {
          await writeSeededObjects();
          return;
        } catch {
          /* storage went away again; try later */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

void boot().catch((error: unknown) => {
  process.stderr.write(`gatecut could not start: ${String(error)}\n`);
  process.exit(1);
});
