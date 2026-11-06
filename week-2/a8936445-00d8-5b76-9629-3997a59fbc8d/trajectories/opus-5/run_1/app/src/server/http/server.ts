import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { JSON_BODY_CAP_BYTES, UPLOAD_REQUEST_CAP_BYTES } from '../domain/constants.js';
import { beginIdempotent, finishIdempotent } from '../db/idempotency.js';
import { userForSessionToken } from '../services/session.js';
import { ApiError, errors } from './errors.js';
import { RequestContext, isJsonResponse, type ApiResponse, type BodyKind } from './context.js';
import { findRoute } from './router.js';
import { serveStatic } from './static.js';
import { BillingUnavailableError } from '../providers/killbill.js';
import { StorageUnavailableError } from '../providers/storage.js';
import { MailUnavailableError } from '../providers/smtp.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

async function readBody(req: IncomingMessage, kind: BodyKind): Promise<{ body: Buffer; over: boolean }> {
  const cap = kind === 'multipart' ? UPLOAD_REQUEST_CAP_BYTES : JSON_BODY_CAP_BYTES;
  const chunks: Buffer[] = [];
  let total = 0;
  let over = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > cap) {
      over = true;
      continue;
    }
    chunks.push(buffer);
  }
  return { body: Buffer.concat(chunks), over };
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof BillingUnavailableError) return errors.billingUnavailable();
  if (error instanceof StorageUnavailableError) return errors.storageUnavailable();
  if (error instanceof MailUnavailableError) return errors.mailUnavailable();
  return new ApiError(500, 'internal_error', 'Something went wrong.');
}

function sendRawJson(res: ServerResponse, status: number, text: string): void {
  const payload = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function sendResponse(res: ServerResponse, response: ApiResponse): void {
  if (isJsonResponse(response)) {
    if (response.status === 204) {
      res.writeHead(204, response.headers ?? {});
      res.end();
      return;
    }
    sendJson(res, response.status, response.json, response.headers ?? {});
    return;
  }
  res.writeHead(response.status, {
    'content-type': response.contentType,
    'content-length': response.buffer.length,
    'x-content-type-options': 'nosniff',
    ...(response.headers ?? {}),
  });
  res.end(response.buffer);
}

function validIdempotencyKey(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < 1 || value.length > 100) return null;
  if (!/^[\x21-\x7e]+$/.test(value)) return null;
  return value;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';

  if (STATE_CHANGING.has(method)) {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      sendJson(res, 403, errors.crossOrigin().body());
      return;
    }
  }

  if (url.pathname.startsWith('/api/inspect/') && method !== 'GET') {
    const failure = errors.readOnly();
    sendJson(res, failure.status, failure.body(), { allow: 'GET' });
    return;
  }

  const found = findRoute(method, url.pathname);
  if (!found.match) {
    const failure = found.pathKnown ? errors.methodNotAllowed() : errors.notFound();
    sendJson(res, failure.status, failure.body());
    return;
  }

  const { route, params } = found.match;
  const { body, over } = await readBody(req, route.bodyKind);
  const rawKey = req.headers['idempotency-key'];
  const headerKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  const ctx = new RequestContext(
    req,
    res,
    method,
    url.pathname,
    url.searchParams,
    params,
    body,
    over,
    validIdempotencyKey(headerKey),
  );

  if (!route.public) {
    const token = readCookie(req.headers.cookie, 'sk_session');
    const user = token ? await userForSessionToken(token) : null;
    if (!user) {
      const failure = errors.unauthenticated();
      sendJson(res, failure.status, failure.body());
      return;
    }
    ctx.user = user;
  }

  const replayable = ctx.user !== null && ctx.idempotencyKey !== null;
  if (replayable) {
    const user = ctx.user!;
    const key = ctx.idempotencyKey!;
    const outcome = await beginIdempotent(user.id, method, url.pathname, key, ctx.bodyFingerprint());
    if (outcome.mode === 'conflict') {
      const failure = errors.idempotencyConflict();
      sendJson(res, failure.status, failure.body());
      return;
    }
    if (outcome.mode === 'replay') {
      sendRawJson(res, outcome.response.status, outcome.response.body);
      return;
    }
    let response: ApiResponse;
    try {
      response = await route.handler(ctx);
    } catch (error) {
      const failure = toApiError(error);
      if (failure.status === 500) console.error(error);
      response = { status: failure.status, json: failure.body() };
    }
    if (isJsonResponse(response)) {
      await finishIdempotent(user.id, method, url.pathname, key, {
        status: response.status,
        body: JSON.stringify(response.json),
      });
    }
    sendResponse(res, response);
    return;
  }

  try {
    sendResponse(res, await route.handler(ctx));
  } catch (error) {
    const failure = toApiError(error);
    if (failure.status === 500) console.error(error);
    sendJson(res, failure.status, failure.body());
  }
}

export function startHttpServer(port: number): void {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    void (async () => {
      try {
        if (url.pathname.startsWith('/api/')) {
          await handleApi(req, res, url);
          return;
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          if (await serveStatic(url.pathname, res)) return;
        }
        sendJson(res, 404, errors.notFound().body());
      } catch (error) {
        console.error(error);
        if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal_error', message: 'Something went wrong.', details: {} } });
        else res.end();
      }
    })();
  });
  server.listen(port, '0.0.0.0');
}
