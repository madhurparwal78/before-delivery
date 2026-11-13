import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config';
import { pool } from '../db';
import { countClaim } from '../domain/limits';
import {
  ApiError,
  forbidden,
  internalError,
  idempotencyKeyRequired,
  payloadTooLarge,
  rateLimited,
  reauthRequired,
  unauthenticated,
  unsupportedMediaType,
  crossOrigin,
  notFound,
} from './errors';
import {
  JSON_BODY_LIMIT,
  UPLOAD_BODY_LIMIT,
  parseJsonBody,
  readMultipartBody,
  readRawBody,
  type MultipartBody,
} from './body';
import { bodyFingerprint, claimKey, isValidKey, releaseKey, storeKeyResponse } from './idempotency';
import { matchRoute, type Ctx, type Reply, type Route } from './route';
import { isCrossSite, SECURITY_HEADERS } from './security';
import { readCookie, userForToken, SESSION_COOKIE, type AuthUser } from './session';
import { unacceptedFields } from './validate';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headerOf(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  headers: Record<string, string>,
  bytes: Buffer | null,
): void {
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  response.statusCode = status;
  if (bytes === null) response.end();
  else response.end(bytes);
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  const text = body === undefined ? '' : JSON.stringify(body);
  sendBytes(
    response,
    status,
    {
      ...SECURITY_HEADERS,
      'cache-control': 'no-store',
      ...(text === '' ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      ...extra,
    },
    text === '' ? null : Buffer.from(text, 'utf8'),
  );
}

async function authenticate(request: IncomingMessage): Promise<AuthUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null || token === '') return null;
  const client = await pool.connect();
  try {
    return await userForToken(client, token);
  } finally {
    client.release();
  }
}

async function requireFreshPasswordConfirmation(user: AuthUser): Promise<void> {
  const result = await pool.query<{ now: Date; password_confirmed_at: Date | null }>(
    'select now() as now, password_confirmed_at from sessions where id = $1',
    [user.sessionId],
  );
  const row = result.rows[0];
  if (row === undefined || row.password_confirmed_at === null) throw reauthRequired();
  const expiresAt = row.password_confirmed_at.getTime() + config.reauthSeconds * 1000;
  if (row.now.getTime() >= expiresAt) throw reauthRequired();
}

async function readBody(
  request: IncomingMessage,
  route: Route,
): Promise<{ body: Record<string, unknown>; multipart: MultipartBody | null }> {
  if (route.multipartFields !== undefined) {
    const multipart = await readMultipartBody(request);
    return { body: {}, multipart };
  }
  const raw = await readRawBody(request, JSON_BODY_LIMIT);
  return { body: parseJsonBody(raw), multipart: null };
}

function checkSizeAndType(request: IncomingMessage, route: Route): void {
  const declaredLength = Number(headerOf(request, 'content-length') ?? '0');
  const limit = route.multipartFields !== undefined ? UPLOAD_BODY_LIMIT : JSON_BODY_LIMIT;
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw payloadTooLarge();

  const contentType = (headerOf(request, 'content-type') ?? '').toLowerCase();
  const hasBody = declaredLength > 0 || headerOf(request, 'transfer-encoding') !== null;
  if (!hasBody) return;
  if (route.multipartFields !== undefined) {
    if (!contentType.startsWith('multipart/form-data')) throw unsupportedMediaType();
    return;
  }
  if (!contentType.startsWith('application/json')) throw unsupportedMediaType();
}

export async function runApiRequest(
  routes: ReadonlyArray<Route>,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = (request.method ?? 'GET').toUpperCase();
  const match = matchRoute(routes, method, url.pathname);
  if (match === null) {
    sendJson(response, 404, notFound().body());
    return;
  }
  const route = match.route;
  let ctx: Ctx | null = null;
  let ownedKey: { userId: string; endpoint: string; key: string } | null = null;

  try {
    checkSizeAndType(request, route);

    if (isCrossSite(request, route.originSensitive === true)) throw crossOrigin();

    const user = await authenticate(request);
    if (route.roles !== 'open' && user === null) throw unauthenticated();

    const { body, multipart } = await readBody(request, route);

    const idempotencyKey = headerOf(request, 'idempotency-key');
    if (route.requiresKey === true && (idempotencyKey === null || !isValidKey(idempotencyKey))) {
      throw idempotencyKeyRequired();
    }

    ctx = {
      method,
      path: url.pathname,
      params: match.params,
      query: url.searchParams,
      request,
      body,
      multipart,
      user,
      idempotencyKey,
      unaccepted:
        route.multipartFields !== undefined && multipart !== null
          ? unacceptedFields(multipart.names, route.multipartFields)
          : unacceptedFields(Object.keys(body), route.bodyFields ?? []),
      store: new Map<string, unknown>(),
    };

    const endpoint = `${route.method} ${route.pattern}`;
    if (route.requiresKey === true && user !== null && idempotencyKey !== null) {
      const fingerprint = bodyFingerprint(
        route.idempotencyBody === undefined ? ctx.body : route.idempotencyBody(ctx),
      );
      const claim = await claimKey(user.id, endpoint, idempotencyKey, fingerprint);
      if (claim.kind === 'replay') {
        sendBytes(
          response,
          claim.status,
          {
            ...SECURITY_HEADERS,
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
            'idempotent-replay': 'true',
          },
          Buffer.from(claim.body, 'utf8'),
        );
        return;
      }
      ownedKey = { userId: user.id, endpoint, key: idempotencyKey };
    }

    if (route.countsClaim === true && user !== null && user.tenantId !== null) {
      const limit = await countClaim(user.tenantId);
      if (limit.limited) throw rateLimited(limit.retryAfterSeconds);
    }

    const pathId = ctx.params.id;
    if (pathId !== undefined && !UUID_PATTERN.test(pathId)) throw notFound();

    if (route.resolve !== undefined) {
      const client = await pool.connect();
      try {
        await route.resolve(ctx, client);
      } finally {
        client.release();
      }
    }

    if (route.roles !== 'open' && (user === null || !route.roles.includes(user.role))) throw forbidden();

    if (route.reauth !== undefined && user !== null && route.reauth(ctx)) {
      await requireFreshPasswordConfirmation(user);
    }

    const reply: Reply = await route.handler(ctx);
    const headers: Record<string, string> = { ...(reply.headers ?? {}) };
    if (reply.cookie !== undefined) headers['set-cookie'] = reply.cookie;

    if (reply.bytes !== undefined) {
      sendBytes(response, reply.status, headers, reply.bytes);
      return;
    }
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    if (ownedKey !== null && reply.status >= 200 && reply.status < 300) {
      await storeKeyResponse(ownedKey.userId, ownedKey.endpoint, ownedKey.key, reply.status, text);
      ownedKey = null;
    }
    sendJson(response, reply.status, reply.body, headers);
  } catch (error) {
    if (ownedKey !== null) {
      await releaseKey(ownedKey.userId, ownedKey.endpoint, ownedKey.key).catch(() => undefined);
    }
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body(), error.headers);
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    const fallback = internalError();
    sendJson(response, fallback.status, fallback.body());
  }
}
