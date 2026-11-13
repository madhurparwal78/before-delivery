import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readShowroomState } from '../shared/urlstate.js';
import { clockNeedsRefresh } from './clock.js';
import { SESSION_COOKIE, lookupSession, type Caller } from './auth.js';
import { migrateAndSeed, refreshClockOffset } from './db.js';
import { ApiError, errorBody } from './errors.js';
import {
  isJsonContentType,
  makeContext,
  MAX_BODY_BYTES,
  parseCookies,
  readBody,
  sendReply,
  type Reply,
} from './http.js';
import { DamagedKey, LedgerDown, subscribeHints } from './ledger.js';
import { nudge, openStream, startLiveLoop } from './live.js';
import { audienceOf, findRoute, runRoute, STREAM_PATTERN, matchPattern } from './api/index.js';
import { noteLedgerFailure, runSweep, sendDueNotices, SWEEP_MS } from './domain/sweep.js';
import { liveReading } from './domain/reading.js';
import { settleDue, tick } from './domain/settle.js';
import { rebuildAllKeys } from './domain/rebuild.js';
import { renderPage, type RouteName } from './render/page.js';
import { selectionFromQuery } from './api/public.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../public');
const fontsDir = resolve(here, '../../public/fonts');

let ready = false;

function parts(pathname: string): string[] {
  return pathname.split('/').filter((part) => part.length > 0);
}

async function serveStatic(pathname: string): Promise<Reply | null> {
  const headers = { 'Cache-Control': 'public, max-age=3600' };
  if (pathname.startsWith('/assets/')) {
    const name = pathname.slice('/assets/'.length);
    if (name.includes('..') || name.includes('/')) return null;
    try {
      const bytes = await readFile(join(publicDir, 'assets', name));
      const type = name.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : name.endsWith('.js')
          ? 'text/javascript; charset=utf-8'
          : 'application/octet-stream';
      return { status: 200, bytes, contentType: type, headers };
    } catch {
      return null;
    }
  }
  if (pathname.startsWith('/fonts/')) {
    const name = pathname.slice('/fonts/'.length);
    if (name.includes('..') || name.includes('/') || !name.endsWith('.woff2')) return null;
    try {
      const bytes = await readFile(join(fontsDir, name));
      return { status: 200, bytes, contentType: 'font/woff2', headers };
    } catch {
      return null;
    }
  }
  return null;
}

async function renderRoute(
  pathname: string,
  query: URLSearchParams,
  caller: Caller | null,
): Promise<Reply> {
  const known = ['/', '/showroom', '/test-ride', '/garage', '/hub'];
  let route: RouteName;
  let wrongRoleSentence: string | undefined;
  if (pathname === '/' || pathname === '/showroom') route = 'long';
  else if (pathname === '/test-ride') route = 'test-ride';
  else if (pathname === '/garage') {
    route = caller?.user.role === 'hub_host' ? 'wrong-role' : 'garage';
    if (route === 'wrong-role') wrongRoleSentence = 'The Garage is for riders.';
  } else if (pathname === '/hub') {
    route = caller?.user.role === 'rider' ? 'wrong-role' : 'hub';
    if (route === 'wrong-role') wrongRoleSentence = 'This console is for hub hosts.';
  } else route = 'not-found';
  const state = readShowroomState(query, pathname === '/');
  const reading = await liveReading(
    state.hub,
    state.model,
    state.finish,
    caller?.user.role === 'rider' ? caller.user.id : null,
  );
  const html = renderPage({
    route,
    user: caller?.user ?? null,
    reading,
    selection: { hub: state.hub, model: state.model, finish: state.finish },
    chapter: state.chapter,
    part: state.part,
    progress: state.progress,
    wrongRoleSentence,
  });
  return { status: known.includes(pathname) ? 200 : 404, html };
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<void> {
  const method = request.method ?? 'GET';
  const segments = parts(pathname);
  let rawBody = Buffer.alloc(0);
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const declared = request.headers['content-length'];
    if (declared && Number(declared) > MAX_BODY_BYTES) throw new ApiError('too_large');
    rawBody = await readBody(request);
    const contentType = request.headers['content-type'];
    if (rawBody.length > 0 && !isJsonContentType(contentType)) {
      throw new ApiError('unsupported_media_type');
    }
  }
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];

  if (method === 'GET' && matchPattern(STREAM_PATTERN, segments)) {
    if (!ready) throw new ApiError('database_unreachable');
    if (clockNeedsRefresh()) await refreshClockOffset();
    const session = await lookupSession(token);
    const ctx = makeContext({ method, path: pathname, params: {}, query, cookies, rawBody });
    const selection = selectionFromQuery(ctx);
    await settleDue();
    await openStream({
      response,
      hub: selection.hub,
      model: selection.model,
      finish: selection.finish,
      token: token ?? null,
      userId: session.caller?.user.role === 'rider' ? session.caller.user.id : null,
    });
    return;
  }

  const matched = findRoute(method, segments);
  if (!ready && !(segments[1] === 'health')) throw new ApiError('database_unreachable');
  if (clockNeedsRefresh()) await refreshClockOffset();
  const audience = audienceOf(matched);
  const session = await lookupSession(token);
  if (audience !== 'public') {
    if (session.state === 'none') throw new ApiError('unauthenticated');
    if (session.state === 'ended') throw new ApiError('session_ended');
  }
  const caller = session.caller;
  if (audience === 'rider' && caller?.user.role !== 'rider') throw new ApiError('forbidden');
  if (audience === 'host' && caller?.user.role !== 'hub_host') throw new ApiError('forbidden');
  const ctx = makeContext({
    method,
    path: pathname,
    params: matched.params,
    query,
    cookies,
    rawBody,
  });
  const reply = await runRoute(matched, ctx, caller);
  sendReply(response, {
    ...reply,
    headers: { ...ctx.responseHeaders, ...reply.headers },
  });
}

async function toReply(error: unknown): Promise<Reply> {
  if (error instanceof ApiError) {
    return { status: error.status, json: errorBody(error.code), headers: error.headers };
  }
  if (error instanceof LedgerDown || error instanceof DamagedKey) {
    await noteLedgerFailure(error).catch(() => undefined);
    return { status: 503, json: errorBody('hub_unreachable') };
  }
  const constraint = (error as { constraint?: string }).constraint;
  if (constraint === 'rides_one_per_slot') {
    return { status: 409, json: errorBody('slot_taken') };
  }
  if (constraint === 'locks_one_active_per_model') {
    return { status: 409, json: errorBody('lock_exists_other_finish') };
  }
  if (constraint === 'rides_one_booked_per_model') {
    return { status: 409, json: errorBody('ride_exists') };
  }
  if (constraint === 'users_mobile_key') {
    return { status: 409, json: errorBody('mobile_taken') };
  }
  process.stderr.write(`request failed: ${(error as Error).stack ?? String(error)}\n`);
  return { status: 503, json: errorBody('database_unreachable') };
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    try {
      if (pathname.startsWith('/api')) {
        await handleApi(request, response, pathname, url.searchParams);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendReply(response, { status: 405, json: errorBody('method_not_allowed'), headers: { Allow: 'GET' } });
        return;
      }
      const asset = await serveStatic(pathname);
      if (asset) {
        sendReply(response, asset);
        return;
      }
      if (!ready) {
        sendReply(response, {
          status: 503,
          html: '<!doctype html><html><body><p>Starting up.</p></body></html>',
        });
        return;
      }
      const cookies = parseCookies(request.headers.cookie);
      if (clockNeedsRefresh()) await refreshClockOffset();
      const session = await lookupSession(cookies[SESSION_COOKIE]);
      await settleDue();
      sendReply(response, await renderRoute(pathname, url.searchParams, session.caller));
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendReply(response, await toReply(error));
    }
  })();
});

const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
server.listen(port, '0.0.0.0');

async function boot(): Promise<void> {
  for (;;) {
    try {
      await migrateAndSeed();
      break;
    } catch (error) {
      process.stderr.write(`startup retry: ${(error as Error).message}\n`);
      await new Promise((done) => setTimeout(done, 2_000));
    }
  }
  ready = true;
  try {
    await rebuildAllKeys();
  } catch {
    /* the sweep rebuilds the keys once the ledger answers */
  }
  subscribeHints(() => nudge());
  startLiveLoop();
  setInterval(() => {
    void tick().catch(() => undefined);
  }, 1_000);
  setInterval(() => {
    void runSweep().catch(() => undefined);
  }, SWEEP_MS);
  setInterval(() => {
    void sendDueNotices().catch(() => undefined);
  }, 2_000);
  void runSweep().catch(() => undefined);
}

void boot();

process.on('unhandledRejection', () => {
  /* a failed background pass is retried on the next tick */
});
