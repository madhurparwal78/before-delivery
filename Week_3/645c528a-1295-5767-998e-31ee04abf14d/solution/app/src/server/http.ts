import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, notFound, validationFailed } from './errors';
import { sessionFromRequest, type Session } from './auth';
import { config } from './config';

const BODY_LIMIT = 65536;

export type Json = Record<string, unknown>;

interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Json;
  session: Session;
  origin: string;
  idempotencyKey: string | undefined;
  headers: IncomingMessage['headers'];
}

export type GuestContext = Omit<Context, 'session'> & { session: Session | null };

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
}

type Authed = (context: Context) => Promise<Reply>;
type Open = (context: GuestContext) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  takesBody: boolean;
  open: boolean;
  handler: Authed | Open;
}

const routes: Route[] = [];

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/\{(\w+)\}/g, (_, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function route(method: string, path: string, handler: Authed, options: { body?: boolean } = {}): void {
  routes.push({ method, ...compile(path), takesBody: options.body ?? false, open: false, handler });
}

export function openRoute(method: string, path: string, handler: Open, options: { body?: boolean } = {}): void {
  routes.push({ method, ...compile(path), takesBody: options.body ?? false, open: true, handler });
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), 'Cache-Control': 'no-store', ...headers });
  response.end(payload);
}

function sendError(response: ServerResponse, error: unknown): void {
  const known = error instanceof ApiError ? error : new ApiError(500, 'internal_error', 'Something went wrong.');
  if (known.status === 500) console.error(error);
  const body = { error: known.code, message: known.message, ...(known.errors ? { errors: known.errors } : {}) };
  sendJson(response, known.status, body, known.headers);
}

export function assertSameOrigin(headers: IncomingMessage['headers']): void {
  const origin = headers.origin;
  if (origin === undefined) return;
  const host = URL.canParse(origin) ? new URL(origin).host : '';
  if (host !== headers.host) throw new ApiError(403, 'cross_origin', 'Cross-origin requests are refused.');
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > BODY_LIMIT) throw new ApiError(413, 'payload_too_large', 'That request is too large.');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function parseBody(raw: Buffer, contentType: string | undefined): Json {
  if (!/^application\/json\b/i.test(contentType ?? '')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send application/json.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(400, 'malformed_json', 'That is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw validationFailed({ body: 'Send a JSON object.' });
  }
  if (holdsNul(parsed)) throw validationFailed({ body: 'Text cannot hold a NUL character.' });
  return parsed as Json;
}

/** Postgres text cannot store U+0000, so it is refused here and never reaches a query. */
function holdsNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\0');
  return typeof value === 'object' && value !== null && Object.values(value).some(holdsNul);
}

function requestOrigin(request: IncomingMessage): string {
  return config.publicUrl ?? `http://${request.headers.host ?? '127.0.0.1'}`;
}

export async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  try {
    const found = routes
      .filter((candidate) => candidate.method === request.method)
      .map((candidate) => ({ candidate, match: candidate.pattern.exec(url.pathname) }))
      .find(({ match }) => match !== null);
    const raw = await readBody(request);
    if (found === undefined) throw notFound();
    const { candidate, match } = found;
    assertSameOrigin(request.headers);
    const body = candidate.takesBody ? parseBody(raw, request.headers['content-type']) : {};
    const session = await sessionFromRequest(request);
    if (session === null && !candidate.open) throw new ApiError(401, 'unauthenticated', 'Sign in first.');
    const params = Object.fromEntries(candidate.keys.map((key, index) => [key, safeDecode((match as RegExpExecArray)[index + 1])]));
    const context = { params, query: url.searchParams, body, session, origin: requestOrigin(request), idempotencyKey: headerValue(request, 'idempotency-key'), headers: request.headers };
    const reply = await (candidate.handler as Open)(context);
    sendJson(response, reply.status, reply.body, reply.headers);
  } catch (error) {
    if (!response.headersSent) sendError(response, error);
    if (!request.complete) request.destroy();
  }
}

function safeDecode(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw notFound();
  }
  if (holdsNul(decoded)) throw notFound();
  return decoded;
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
