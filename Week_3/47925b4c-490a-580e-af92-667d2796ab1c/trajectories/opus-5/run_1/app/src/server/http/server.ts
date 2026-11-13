import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ProblemError, problem } from './problem.js';
import { asObject, checkMembers, type Shape } from './validate.js';
import { replayOrRun } from './idempotency.js';

export const JSON_BODY_LIMIT = 1_000_000;
export const PHOTO_BODY_LIMIT = 40_000_000;

export interface Reply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly raw?: Buffer;
  readonly contentType?: string;
}

export interface RequestContext {
  readonly method: string;
  readonly path: string;
  readonly search: URLSearchParams;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: IncomingMessage['headers'];
  readonly body: Record<string, unknown>;
  readonly raw: Buffer;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
}

export type Handler = (context: RequestContext) => Promise<Reply>;

export interface RouteOptions {
  readonly shape?: Shape;
  readonly keyed?: boolean;
  readonly emptyAllowed?: boolean;
  readonly rawBody?: boolean;
  readonly stream?: boolean;
}

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: Handler;
  readonly options: RouteOptions;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler, options: RouteOptions = {}): void {
  routes.push({ method, segments: pattern.split('/').filter((part) => part !== ''), handler, options });
}

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
  const parts = path.split('/').filter((part) => part !== '');
  let pathMatched = false;
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (const [index, segment] of candidate.segments.entries()) {
      const part = parts[index] ?? '';
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(part);
      else if (segment !== part) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    pathMatched = true;
    if (candidate.method === method || (method === 'HEAD' && candidate.method === 'GET')) {
      return { route: candidate, params };
    }
  }
  return pathMatched ? 'method' : null;
}

function allowedMethods(path: string): string[] {
  const parts = path.split('/').filter((part) => part !== '');
  const methods = new Set<string>();
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    let matches = true;
    for (const [index, segment] of candidate.segments.entries()) {
      if (segment.startsWith(':')) continue;
      if (segment !== (parts[index] ?? '')) {
        matches = false;
        break;
      }
    }
    if (matches) methods.add(candidate.method);
  }
  if (methods.has('GET')) methods.add('HEAD');
  return [...methods].sort();
}

function ownOrigins(request: IncomingMessage): string[] {
  const host = request.headers.host ?? '';
  return [`http://${host}`, `https://${host}`];
}

export function checkOrigin(request: IncomingMessage): void {
  const method = request.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (!ownOrigins(request).includes(origin)) throw problem('origin_refused');
}

async function readBody(request: IncomingMessage, limit: number, tooLarge: 'body_too_large' | 'photo_too_large'): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw problem(tooLarge);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > limit) {
      request.destroy();
      throw problem(tooLarge);
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function isJsonType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const type = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return type === 'application/json' || type.endsWith('+json');
}

export function idempotencyKey(headers: IncomingMessage['headers']): string {
  const raw = headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== 'string' || key.length < 1 || key.length > 128 || !/^[\x20-\x7e]+$/.test(key)) {
    throw problem('idempotency_key_required');
  }
  return key;
}

export function sendReply(response: ServerResponse, reply: Reply, head: boolean): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  let payload: Buffer;
  if (reply.raw !== undefined) {
    payload = reply.raw;
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
  } else if (reply.body === undefined) {
    payload = Buffer.alloc(0);
  } else {
    payload = Buffer.from(JSON.stringify(reply.body));
    headers['Content-Type'] = reply.contentType ?? 'application/json';
  }
  headers['Content-Length'] = String(payload.length);
  headers['X-Content-Type-Options'] = 'nosniff';
  response.writeHead(reply.status, headers);
  response.end(head ? undefined : payload);
}

export function sendProblem(response: ServerResponse, error: ProblemError, head: boolean): void {
  sendReply(
    response,
    {
      status: error.status,
      body: error.body,
      headers: { ...error.headers, 'Cache-Control': 'no-store' },
      contentType: 'application/problem+json',
    },
    head,
  );
}

export async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const head = method === 'HEAD';
  const url = new URL(request.url ?? '/', 'http://app.invalid');
  try {
    checkOrigin(request);
    const matched = matchRoute(method, url.pathname);
    if (matched === null) throw problem('not_found');
    if (matched === 'method') {
      throw problem('method_not_allowed', { headers: { Allow: allowedMethods(url.pathname).join(', ') } });
    }
    const { route: chosen, params } = matched;
    const limit = chosen.options.rawBody ? PHOTO_BODY_LIMIT : JSON_BODY_LIMIT;
    const raw = chosen.options.stream
      ? Buffer.alloc(0)
      : await readBody(request, limit, chosen.options.rawBody ? 'photo_too_large' : 'body_too_large');

    const bodyExpected = method === 'POST' || method === 'PUT' || method === 'PATCH';
    let body: Record<string, unknown> = {};
    if (!chosen.options.rawBody && !chosen.options.stream && bodyExpected) {
      const empty = raw.length === 0;
      if (empty && chosen.options.emptyAllowed !== true) throw problem('malformed_body');
      if (!empty) {
        if (!isJsonType(request.headers['content-type'])) throw problem('unsupported_media_type');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          throw problem('malformed_body');
        }
        body = asObject(parsed);
        if (chosen.options.shape !== undefined) checkMembers(body, chosen.options.shape);
      }
    }

    const context: RequestContext = {
      method,
      path: url.pathname,
      search: url.searchParams,
      params,
      headers: request.headers,
      body,
      raw,
      request,
      response,
    };

    if (chosen.options.keyed === true) {
      const key = idempotencyKey(request.headers);
      const fingerprint = createHash('sha256').update(raw).digest('hex');
      const stored = await replayOrRun(method, url.pathname, key, fingerprint, async () => chosen.handler(context));
      if (stored.replayed) {
        sendReply(response, { ...stored.reply, headers: { ...(stored.reply.headers ?? {}), 'Idempotency-Replayed': 'true' } }, head);
        return;
      }
      sendReply(response, stored.reply, head);
      return;
    }

    const reply = await chosen.handler(context);
    if (chosen.options.stream === true) return;
    sendReply(response, reply, head);
  } catch (error) {
    if (error instanceof ProblemError) {
      if (!response.headersSent) sendProblem(response, error, head);
      else response.end();
      return;
    }
    process.stderr.write(`request failure ${url.pathname}: ${String((error as Error).message)}\n`);
    if (!response.headersSent) sendProblem(response, problem('internal_error'), head);
    else response.end();
  }
}
