import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  HttpError,
  crossSiteRequest,
  internalError,
  notFound,
  payloadTooLarge,
  unauthenticated,
  unsupportedMediaType,
} from './errors.js';
import { parseJson } from './json.js';
import { boundaryOf, parseMultipart, type MultipartPart } from './multipart.js';

export const JSON_BODY_LIMIT = 100_000;
export const PHOTO_LIMIT = 5_000_000;
export const CSV_LIMIT = 1_000_000;
const ENVELOPE_SLACK = 200_000;

export type BodyKind = 'json' | 'photo' | 'csv';

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  parts: MultipartPart[];
  sessionId: string | null;
}

export interface Route {
  method: string;
  pattern: string;
  auth: 'owner' | 'public';
  body: BodyKind;
  handler: (ctx: Ctx) => Promise<Reply>;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index] as string;
    const actual = pathParts[index] as string;
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > max) throw payloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isCrossSite(req: IncomingMessage): boolean {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') return true;
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  if (origin === 'null') return true;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

export function errorReply(error: HttpError): Reply {
  const reply: Reply = { status: error.status, json: error.body() };
  if (error.headers !== undefined) reply.headers = error.headers;
  return reply;
}

export interface ApiHandlerOptions {
  routes: Route[];
  sessionFor: (req: IncomingMessage) => Promise<string | null>;
}

/**
 * The API pipeline: body limit, content type, cross-site, session, route, then
 * the handler, in the published error order.
 */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: ApiHandlerOptions,
): Promise<Reply> {
  const method = req.method ?? 'GET';
  const match = options.routes
    .map((route) => ({ route, params: route.method === method ? matchPath(route.pattern, url.pathname) : null }))
    .find((candidate) => candidate.params !== null);
  const kind: BodyKind = match?.route.body ?? 'json';
  const contentType = req.headers['content-type'] ?? '';
  const mediaType = contentType.toLowerCase();

  let raw = Buffer.alloc(0);
  let parts: MultipartPart[] = [];
  let body: unknown = {};

  if (WRITE_METHODS.has(method)) {
    const limit = kind === 'json' ? JSON_BODY_LIMIT : (kind === 'photo' ? PHOTO_LIMIT : CSV_LIMIT);
    raw = await readBody(req, kind === 'json' ? limit : limit + ENVELOPE_SLACK);
    if (kind === 'json') {
      if (raw.length > 0 && !mediaType.startsWith('application/json')) {
        throw unsupportedMediaType();
      }
    } else {
      if (!mediaType.startsWith('multipart/form-data')) throw unsupportedMediaType();
      const boundary = boundaryOf(contentType);
      parts = boundary === null ? [] : parseMultipart(raw, boundary);
      const file = parts.find((part) => part.filename !== null);
      if (file !== undefined && file.bytes.length > limit) throw payloadTooLarge();
    }
    if (isCrossSite(req)) throw crossSiteRequest();
  }

  const sessionId = await options.sessionFor(req);
  if (match === undefined || match.route.auth === 'owner') {
    if (sessionId === null) throw unauthenticated();
  }
  if (match === undefined) throw notFound('');

  if (WRITE_METHODS.has(method) && kind === 'json' && raw.length > 0) {
    try {
      body = parseJson(raw.toString('utf8'));
    } catch {
      body = {};
    }
  }

  return match.route.handler({
    req,
    res,
    url,
    params: match.params ?? {},
    body,
    parts,
    sessionId,
  });
}

export function toReply(error: unknown): Reply {
  if (error instanceof HttpError) return errorReply(error);
  console.error('unexpected failure', error);
  return errorReply(internalError());
}
