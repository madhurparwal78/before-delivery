import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, fail } from './errors.js';
import {
  JSON_BODY_LIMIT,
  checkContentType,
  readBody,
  readCookie,
  refuseCrossOrigin,
  SESSION_COOKIE,
} from './boundary.js';
import { Router, type Reply, type Route } from './router.js';
import { isStaff, isSignedIn } from '../domain/couriers.js';
import { resolveActor, type Actor } from '../domain/sessions.js';

export interface Handled {
  request: IncomingMessage;
  method: string;
  url: URL;
  params: Record<string, string>;
  body: Buffer;
  actor: Actor | null;
  now: Date;
}

export type AppHandler = (context: Handled) => Promise<Reply>;
export type AppRoute = Route<AppHandler>;

const router = new Router<AppHandler>();

export function register(routes: AppRoute[]): void {
  for (const route of routes) {
    router.add(route);
  }
}

function refuseRole(auth: AppRoute['auth'], actor: Actor | null): void {
  if (auth === 'anyone') return;
  if (actor === null) throw fail('unauthenticated');
  if (auth === 'courier' && !isSignedIn(actor.courier.role)) throw fail('sign_in_required');
  if (auth === 'staff' && !isStaff(actor.courier.role)) throw fail('staff_only');
  if (auth === 'founder' && actor.courier.role !== 'founder') throw fail('founder_only');
}

async function run(request: IncomingMessage, url: URL): Promise<Reply> {
  const method = request.method ?? 'GET';
  const resolved = router.resolve(method, url.pathname);

  refuseCrossOrigin(request);

  const limit =
    resolved === 'not_found' || resolved === 'method_not_allowed'
      ? JSON_BODY_LIMIT
      : resolved.route.bodyLimit ?? JSON_BODY_LIMIT;
  const body = await readBody(request, limit);
  if (resolved !== 'not_found' && resolved !== 'method_not_allowed') {
    checkContentType(request, resolved.route.bodyKind, body.length);
  }

  if (resolved === 'not_found') throw fail('not_found');
  if (resolved === 'method_not_allowed') throw fail('method_not_allowed');

  const wantsActor = resolved.route.auth !== 'anyone' || resolved.route.withActor === true;
  const actor = wantsActor ? await resolveActor(readCookie(request, SESSION_COOKIE)) : null;

  refuseRole(resolved.route.auth, actor);

  return resolved.route.handler({
    request,
    method,
    url,
    params: resolved.params,
    body,
    actor,
    now: new Date(),
  });
}

function write(response: ServerResponse, method: string, reply: Reply): void {
  const headers: Record<string, string> = { ...reply.headers };
  let payload: Buffer;
  if (reply.json !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
  } else if (reply.body !== undefined) {
    if (reply.contentType !== undefined) headers['Content-Type'] = reply.contentType;
    payload = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body, 'utf8');
  } else {
    payload = Buffer.alloc(0);
  }
  headers['Content-Length'] = String(payload.length);
  if (reply.setCookie !== undefined) headers['Set-Cookie'] = reply.setCookie;
  response.writeHead(reply.status, headers);
  response.end(method === 'HEAD' ? undefined : payload);
}

export async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  let url: URL;
  try {
    url = new URL(request.url ?? '/', 'http://bramble.invalid');
  } catch {
    write(response, method, { status: 404, json: fail('not_found').body() });
    return;
  }
  try {
    write(response, method, await run(request, url));
  } catch (fault) {
    if (fault instanceof ApiError) {
      write(response, method, {
        status: fault.status,
        json: fault.body(),
        headers: fault.headers,
      });
      return;
    }
    process.stderr.write(`unexpected fault handling ${method} ${url.pathname}\n`);
    const internal = fail('internal');
    write(response, method, { status: internal.status, json: internal.body() });
  }
}
