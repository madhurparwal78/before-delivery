import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BODY_LIMIT, MULTIPART_LIMIT } from './config.js';
import { ApiError, SERVICE_TEXT, ServiceDownError, notSignedIn } from './errors.js';
import type { PersonRow } from './auth.js';
import { SESSION_COOKIE, personForToken, readCookie } from './auth.js';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  person: PersonRow | null;
  origin: string;
}

export type Handler = (ctx: RequestContext) => Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  auth: 'required' | 'open';
}

const routes: Route[] = [];

export function route(method: string, path: string, auth: 'required' | 'open', handler: Handler): void {
  routes.push({ method, segments: path.split('/').filter((part) => part !== ''), handler, auth });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store'
  });
  res.end(payload);
}

export function personOrThrow(ctx: RequestContext): PersonRow {
  if (ctx.person === null) throw notSignedIn();
  return ctx.person;
}

export async function readRawBody(ctx: RequestContext, limit: number, overLimit: ApiError): Promise<Buffer> {
  const declared = Number(ctx.req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) throw overLimit;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of ctx.req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw overLimit;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export const tooLarge = (): ApiError => new ApiError(413, 'That request is too large.');

export async function readJsonBody(ctx: RequestContext, limit = JSON_BODY_LIMIT): Promise<Record<string, unknown>> {
  const raw = await readRawBody(ctx, limit, tooLarge());
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(422, 'Send a JSON body.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(422, 'Send a JSON body.');
  }
  return parsed as Record<string, unknown>;
}

export const multipartTooLarge = (): ApiError =>
  new ApiError(413, 'This model is over the Granite limit for file size.');

export async function readMultipartBody(ctx: RequestContext): Promise<Buffer> {
  return readRawBody(ctx, MULTIPART_LIMIT, multipartTooLarge());
}

function matchRoute(method: string, segments: string[]): { route: Route; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < segments.length; index += 1) {
      const pattern = candidate.segments[index] ?? '';
      const actual = segments[index] ?? '';
      if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(actual);
      else if (pattern !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

export function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

export function serviceError(error: ServiceDownError): ApiError {
  return new ApiError(503, error.service === 'valkey' ? SERVICE_TEXT.valkey : SERVICE_TEXT.storageWrite);
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const segments = url.pathname.split('/').filter((part) => part !== '');
  const matched = matchRoute(req.method ?? 'GET', segments);
  if (matched === null) {
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not found.' });
      return true;
    }
    return false;
  }
  const ctx: RequestContext = {
    req,
    res,
    url,
    params: matched.params,
    person: null,
    origin: typeof req.headers.origin === 'string' ? req.headers.origin : ''
  };
  try {
    if (matched.route.auth === 'required') {
      const person = await personForToken(readCookie(req.headers.cookie, SESSION_COOKIE));
      if (person === null || !person.confirmed || person.suspended) throw notSignedIn();
      ctx.person = person;
    } else {
      ctx.person = await personForToken(readCookie(req.headers.cookie, SESSION_COOKIE));
      if (ctx.person !== null && (!ctx.person.confirmed || ctx.person.suspended)) ctx.person = null;
    }
    await matched.route.handler(ctx);
  } catch (error) {
    if (res.headersSent) return true;
    if (error instanceof ApiError) sendJson(res, error.status, { error: error.message });
    else if (error instanceof ServiceDownError) {
      const mapped = serviceError(error);
      sendJson(res, mapped.status, { error: mapped.message });
    } else {
      process.stderr.write(`request failed: ${String(error)}\n`);
      sendJson(res, 500, { error: 'Something went wrong.' });
    }
  }
  return true;
}
