import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

export const JSON_BODY_MAX_BYTES = 1_000_000;

export type SessionRecord = {
  id: string;
  secret: string;
  csrfToken: string;
  label: string;
  createdAt: Date;
  lastSeenAt: Date;
};

export type Reply = {
  status: number;
  body?: unknown;
  raw?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
};

export type RequestContext = {
  method: string;
  url: URL;
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
  json: unknown;
  params: Record<string, string>;
  session: SessionRecord | null;
  peerAddress: string;
  cookies: Record<string, string>;
  raw: IncomingMessage;
  response: ServerResponse;
};

/** The one error shape of the API. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly payload: Record<string, unknown>,
    readonly extraHeaders: Record<string, string> = {},
  ) {
    super(`http ${status}`);
  }
}

export function errorReply(status: number, code: string, extra: Record<string, unknown> = {}): HttpError {
  return new HttpError(status, { error: code, ...extra });
}

/** The status-only bodies the API lists as exceptions to the error shape. */
export function statusOnly(status: number, statusWord: string): HttpError {
  return new HttpError(status, { status: statusWord });
}

export function validationError(errors: Record<string, string>): HttpError {
  return new HttpError(422, { error: 'validation', errors });
}

export const notFound = (): HttpError => errorReply(404, 'not_found');
export const unauthenticated = (): HttpError => errorReply(401, 'unauthenticated');
export const csrfFailed = (): HttpError => errorReply(403, 'csrf_failed');
export const tooLarge = (): HttpError => errorReply(413, 'too_large');
export const unsupportedMediaType = (): HttpError => errorReply(415, 'unsupported_media_type');

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Reply {
  return { status, body, headers };
}

export function noContent(headers: Record<string, string> = {}): Reply {
  return { status: 204, headers };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name.length > 0) out[name] = decodeURIComponent(value);
  }
  return out;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  const chunks: Buffer[] = [];
  let total = 0;
  let exceeded = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      exceeded = true;
      chunks.length = 0;
      continue;
    }
    if (!exceeded) chunks.push(buffer);
  }
  return exceeded ? 'too_large' : Buffer.concat(chunks);
}

export function contentTypeOf(headers: IncomingHttpHeaders): string {
  const value = headers['content-type'];
  if (typeof value !== 'string') return '';
  return value.split(';')[0].trim().toLowerCase();
}

export type Route = {
  method: string;
  pattern: string;
  segments: string[];
  handler: (context: RequestContext) => Promise<Reply>;
};

export function route(
  method: string,
  pattern: string,
  handler: (context: RequestContext) => Promise<Reply>,
): Route {
  return { method, pattern, segments: pattern.split('/').filter((part) => part.length > 0), handler };
}

export function matchRoute(
  routes: Route[],
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/').filter((part) => part.length > 0);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const segment = candidate.segments[index];
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(parts[index]);
        continue;
      }
      if (segment !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

export function sendReply(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (reply.raw !== undefined) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    headers['Content-Length'] = String(reply.raw.length);
    res.writeHead(reply.status, headers);
    res.end(reply.raw);
    return;
  }
  if (reply.body === undefined || reply.status === 204) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body), 'utf8');
  headers['Content-Type'] = reply.contentType ?? 'application/json';
  headers['Content-Length'] = String(payload.length);
  res.writeHead(reply.status, headers);
  res.end(payload);
}

export function labelFromUserAgent(userAgent: string | undefined): string {
  if (userAgent === undefined || userAgent.trim() === '') return 'Unknown browser';
  const browsers: [RegExp, string][] = [
    [/Edg\//, 'Edge'],
    [/OPR\//, 'Opera'],
    [/Firefox\//, 'Firefox'],
    [/Chrome\//, 'Chrome'],
    [/Version\/.*Safari\//, 'Safari'],
    [/Safari\//, 'Safari'],
  ];
  const systems: [RegExp, string][] = [
    [/Windows NT/, 'Windows'],
    [/Android/, 'Android'],
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Mac OS X/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
  ];
  const browser = browsers.find(([pattern]) => pattern.test(userAgent));
  const system = systems.find(([pattern]) => pattern.test(userAgent));
  if (browser === undefined || system === undefined) return 'Unknown browser';
  return `${browser[1]} on ${system[1]}`;
}
