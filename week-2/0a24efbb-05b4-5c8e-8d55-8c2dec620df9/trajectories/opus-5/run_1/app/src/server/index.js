import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import Fastify from 'fastify';
import { MAX_BODY_BYTES } from '../shared/constants.js';
import { feedback, refusals, ui } from '../shared/copy.js';
import { encodeNext, safeNext } from '../shared/safeNext.js';
import { allowHeader, resolveEndpoint } from './api.js';
import { parseJsonBody } from './bodyChecks.js';
import { SESSION_COOKIE, config } from './config.js';
import { Refusal } from './errors.js';
import {
  bareShell,
  buildCalendarPage,
  buildPolicyPage,
  buildQueuePage,
  buildSharedMonthPage,
  currentPolicyVersion,
  deskShell,
  queueBreadcrumb,
  queueScreenName,
  sharedShell,
} from './pages.js';
import { readinessState, startReadiness } from './readiness.js';
import { CLIENT_ROOT, renderAnswer, renderRoute } from './render.jsx';
import { shareLinkByToken } from './shareLinks.js';
import { readSession } from './sessions.js';

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const PAGE_ROLES = {
  queue: ['employee', 'manager', 'admin'],
  detail: ['employee', 'manager', 'admin'],
  draft: ['employee', 'manager'],
  calendar: ['manager', 'admin'],
  policy: ['admin'],
};

const app = Fastify({ bodyLimit: 2 * 1024 * 1024, logger: false });

app.removeAllContentTypeParsers();
app.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => done(null, body));

function applyHeaders(reply, sharedMonth) {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('content-security-policy', "frame-ancestors 'none'");
  reply.header('referrer-policy', sharedMonth ? 'no-referrer' : 'strict-origin-when-cross-origin');
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionMaxSeconds}`;
}

function clearedCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function presentedToken(request) {
  const authorisation = request.headers.authorization;
  if (typeof authorisation === 'string' && authorisation.toLowerCase().startsWith('bearer ')) {
    return authorisation.slice(7).trim();
  }
  const cookies = request.headers.cookie;
  if (typeof cookies !== 'string') return null;
  for (const pair of cookies.split(';')) {
    const at = pair.indexOf('=');
    if (at === -1) continue;
    if (pair.slice(0, at).trim() === SESSION_COOKIE) return pair.slice(at + 1).trim();
  }
  return null;
}

function sendJson(reply, status, body, extra = {}) {
  for (const [name, value] of Object.entries(extra.headers ?? {})) reply.header(name, value);
  reply.status(status).type('application/json; charset=utf-8');
  return reply.send(status === 204 || body === null ? '' : JSON.stringify(body));
}

function sendHtml(reply, status, html) {
  reply.status(status).type('text/html; charset=utf-8');
  return reply.send(html);
}

function decodeSegments(path) {
  const segments = path.split('/');
  const decoded = [];
  for (const segment of segments) {
    if (segment === '') return null;
    try {
      decoded.push(decodeURIComponent(segment));
    } catch {
      decoded.push(segment);
    }
  }
  return decoded;
}

function serveAsset(reply, rawPath) {
  const relative = normalize(decodeURIComponent(rawPath)).replace(/^(\.\.[/\\])+/, '');
  const file = join(CLIENT_ROOT, relative);
  if (!file.startsWith(CLIENT_ROOT) || !existsSync(file) || !statSync(file).isFile()) return null;
  reply.header('cache-control', 'public, max-age=31536000, immutable');
  reply.type(CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
  return reply.send(createReadStream(file));
}

/* ---------- the API ---------- */

async function handleApi(request, reply, { rawPath, searchParams, method }) {
  const segments = rawPath === '/api' ? [] : decodeSegments(rawPath.slice(5));
  const resolved = segments === null ? null : resolveEndpoint(segments);
  if (!resolved) return sendJson(reply, 404, { error: refusals.noEndpoint });

  const { endpoint, params } = resolved;
  const target = method === 'HEAD' ? 'GET' : method;
  const handler = endpoint.methods[target];
  if (!handler) {
    return sendJson(reply, 405, { error: refusals.methodNotAllowed }, { headers: { allow: allowHeader(endpoint) } });
  }

  const token = presentedToken(request);
  const open = endpoint.openToEveryone || (endpoint.openMethods ?? []).includes(target);

  let caller = null;
  if (!open) {
    const read = await readSession(token);
    if (read.failure) return sendJson(reply, read.failure.status, read.failure.body);
    caller = read.person;
  }

  const raw = request.body;
  if (raw && raw.length > MAX_BODY_BYTES) throw new Refusal(413, refusals.bodyTooLarge);
  const body = parseJsonBody(raw, request.headers['content-type']);

  const answer = await handler({
    caller,
    body,
    params,
    searchParams,
    headers: request.headers,
    presentedToken: token,
  });

  if (answer.setSessionCookie) reply.header('set-cookie', sessionCookie(answer.setSessionCookie));
  if (answer.clearSessionCookie) reply.header('set-cookie', clearedCookie());
  for (const [name, value] of Object.entries(answer.headers ?? {})) reply.header(name, value);
  if (answer.contentType) {
    reply.status(answer.status).type(answer.contentType);
    return reply.send(method === 'HEAD' ? '' : answer.body);
  }
  reply.status(answer.status).type('application/json; charset=utf-8');
  return reply.send(method === 'HEAD' || answer.status === 204 || answer.body === null ? '' : JSON.stringify(answer.body));
}

/* ---------- the pages ---------- */

function matchPageRoute(rawPath) {
  if (rawPath === '/') return { id: 'root' };
  if (rawPath === '/login') return { id: 'login' };
  if (rawPath === '/requests') return { id: 'queue' };
  if (rawPath === '/requests/new') return { id: 'draft' };
  if (rawPath === '/calendar') return { id: 'calendar' };
  if (rawPath === '/policy') return { id: 'policy' };
  if (rawPath.startsWith('/requests/')) {
    const segment = rawPath.slice('/requests/'.length);
    if (segment !== '' && !segment.includes('/')) return { id: 'detail', idSegment: decodeOne(segment) };
  }
  if (rawPath.startsWith('/share/')) {
    const segment = rawPath.slice('/share/'.length);
    if (segment !== '' && !segment.includes('/')) return { id: 'share', token: decodeOne(segment) };
  }
  return null;
}

function decodeOne(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function answerPage(reply, status, kind, shell) {
  return sendHtml(reply, status, renderAnswer({ kind, shell }));
}

async function signedOutNotFound(reply) {
  return answerPage(reply, 404, 'notFound', bareShell({ screenName: feedback.notFoundHeading }));
}

async function handleShare(reply, token, rawUrl) {
  const read = await shareLinkByToken(token);
  if (read.status === 404) return signedOutNotFound(reply);
  if (read.status === 410) {
    return answerPage(reply, 410, 'gone', sharedShell({ screenName: feedback.goneHeading }));
  }
  const page = await buildSharedMonthPage({ person: read.person, month: read.link.month });
  const html = await renderRoute({
    url: `${config.publicUrl}${rawUrl}`,
    routeId: 'share',
    shell: sharedShell({ screenName: page.screenName }),
    page,
    hydrate: false,
  });
  return sendHtml(reply, 200, html);
}

async function handlePage(request, reply, { rawPath, rawUrl, searchParams }) {
  const route = matchPageRoute(rawPath);
  if (!route) return signedOutNotFound(reply);
  if (route.id === 'share') return handleShare(reply, route.token, rawUrl);

  const token = presentedToken(request);
  const read = token ? await readSession(token) : { failure: null, person: null };
  const caller = read.person ?? null;
  const sessionDidEnd = Boolean(read.failure && read.failure.wording === refusals.sessionEnded);

  if (!caller) {
    if (route.id === 'login') {
      const notice = sessionDidEnd
        ? refusals.sessionEnded
        : searchParams.has('signed_out')
          ? ui.signedOutNotice
          : readinessState().flags.realm
            ? null
            : refusals.signInUnavailable;
      const nextTarget = safeNext(searchParams.get('next') ?? '');
      const html = await renderRoute({
        url: `${config.publicUrl}${rawUrl}`,
        routeId: 'login',
        shell: bareShell({ screenName: ui.signInHeading, announcement: notice ?? '' }),
        page: { next: nextTarget, notice },
        hydrate: true,
      });
      return sendHtml(reply, 200, html);
    }
    if (rawPath === '/') return reply.status(303).header('location', '/login').send('');
    return reply
      .status(303)
      .header('location', `/login?next=${encodeNext(rawUrl)}`)
      .send('');
  }

  if (route.id === 'login') {
    const target = safeNext(searchParams.get('next') ?? '') ?? '/requests';
    return reply.status(303).header('location', target).send('');
  }
  if (route.id === 'root') return reply.status(303).header('location', '/requests').send('');

  const policyVersion = await currentPolicyVersion();
  if (!PAGE_ROLES[route.id].includes(caller.role)) {
    return answerPage(
      reply,
      403,
      'wrongRole',
      deskShell({ caller, policyVersion, screenName: feedback.wrongRole }),
    );
  }

  if (route.id === 'calendar') {
    let page;
    try {
      page = await buildCalendarPage({ caller, searchParams });
    } catch (error) {
      if (error instanceof Refusal && error.status === 400) {
        return answerPage(
          reply,
          400,
          'badQuery',
          deskShell({ caller, policyVersion, screenName: feedback.badQuery }),
        );
      }
      throw error;
    }
    const html = await renderRoute({
      url: `${config.publicUrl}${rawUrl}`,
      routeId: 'calendar',
      shell: deskShell({ caller, policyVersion, screenName: ui.calendarHeading }),
      page,
      hydrate: true,
    });
    return sendHtml(reply, 200, html);
  }

  if (route.id === 'policy') {
    const page = await buildPolicyPage(caller);
    const html = await renderRoute({
      url: `${config.publicUrl}${rawUrl}`,
      routeId: 'policy',
      shell: deskShell({ caller, policyVersion, screenName: ui.policyHeading }),
      page,
      hydrate: true,
    });
    return sendHtml(reply, 200, html);
  }

  const mode = route.id === 'draft' ? 'draft' : route.id === 'detail' ? 'detail' : 'queue';
  let built;
  try {
    built = await buildQueuePage({ caller, mode, searchParams, idSegment: route.idSegment });
  } catch (error) {
    if (error instanceof Refusal && error.status === 404) {
      return answerPage(
        reply,
        404,
        'notFound',
        deskShell({ caller, policyVersion, screenName: feedback.notFoundHeading }),
      );
    }
    throw error;
  }
  if (built.answer) {
    return answerPage(
      reply,
      400,
      built.answer,
      deskShell({ caller, policyVersion, screenName: feedback.badQuery }),
    );
  }

  const screenName = queueScreenName(mode, built.page);
  const shell = deskShell({
    caller,
    policyVersion,
    screenName,
    layout: mode === 'detail' ? 'split' : 'wide',
    announcement: ui.pageOf(built.page.queue.page, built.page.queue.pages),
  });
  shell.breadcrumb = queueBreadcrumb(screenName, built.query);
  const html = await renderRoute({
    url: `${config.publicUrl}${rawUrl}`,
    routeId: route.id,
    shell,
    page: built.page,
    hydrate: true,
  });
  return sendHtml(reply, 200, html);
}

/* ---------- the one entry point ---------- */

async function handle(request, reply) {
  const rawUrl = request.raw.url;
  const queryAt = rawUrl.indexOf('?');
  const rawPath = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
  const searchParams = new URLSearchParams(queryAt === -1 ? '' : rawUrl.slice(queryAt + 1));
  const sharedMonth = rawPath === '/share' || rawPath.startsWith('/share/');
  applyHeaders(reply, sharedMonth);

  const carriesShareToken = sharedMonth || searchParams.has('share');
  if (carriesShareToken && request.method !== 'GET' && request.method !== 'HEAD') {
    return sendJson(reply, 403, { error: refusals.shareReadOnly });
  }

  if (rawPath.startsWith('/assets/') || rawPath.startsWith('/fonts/')) {
    const sent = serveAsset(reply, rawPath);
    if (sent) return sent;
    return signedOutNotFound(reply);
  }

  if (rawPath === '/api' || rawPath.startsWith('/api/')) {
    return handleApi(request, reply, { rawPath, searchParams, method: request.method });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return signedOutNotFound(reply);
  return handlePage(request, reply, { rawPath, rawUrl, searchParams });
}

app.route({
  method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  url: '/',
  handler: handle,
});
app.route({
  method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  url: '/*',
  handler: handle,
});

app.setErrorHandler((error, request, reply) => {
  const rawPath = request.raw.url.split('?')[0];
  applyHeaders(reply, rawPath.startsWith('/share/'));

  const refusal =
    error instanceof Refusal
      ? error
      : error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? new Refusal(413, refusals.bodyTooLarge)
        : new Refusal(500, refusals.serverError);

  if (refusal.extra.retryAfter !== undefined) reply.header('retry-after', String(refusal.extra.retryAfter));
  if (refusal.extra.etag !== undefined) reply.header('etag', refusal.extra.etag);
  reply.status(refusal.status).type('application/json; charset=utf-8');
  return reply.send(JSON.stringify(refusal.body));
});

app.setNotFoundHandler((request, reply) => {
  applyHeaders(reply, false);
  return sendHtml(reply, 404, renderAnswer({ kind: 'notFound', shell: bareShell({ screenName: feedback.notFoundHeading }) }));
});

startReadiness();

await app.listen({ host: '0.0.0.0', port: config.publicPort });
