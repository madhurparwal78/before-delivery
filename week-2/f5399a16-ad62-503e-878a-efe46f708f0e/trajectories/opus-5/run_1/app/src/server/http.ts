import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BODY_LIMIT } from './config.js';

export type Fields = Record<string, string>;

/** One error shape, produced in one way across every endpoint. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Fields,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const refuse = {
  notFound: (): ApiError => new ApiError(404, 'notFound', 'Nothing lives at that address.'),
  methodNotAllowed: (allow: readonly string[]): ApiError =>
    new ApiError(405, 'methodNotAllowed', 'That method is not allowed here.', undefined, {
      allow: allow.join(', '),
    }),
  tooLarge: (message: string): ApiError => new ApiError(413, 'tooLarge', message),
  rateLimited: (message: string, retryAfterSeconds: number): ApiError =>
    new ApiError(429, 'rateLimited', message, undefined, {
      'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))),
    }),
  foreignOrigin: (): ApiError =>
    new ApiError(403, 'foreignOrigin', 'That request came from another origin.'),
  notSignedIn: (): ApiError => new ApiError(401, 'notSignedIn', 'Sign in to use this desk.'),
  sessionEnded: (message: string): ApiError => new ApiError(401, 'session_ended', message),
  pageEnded: (message: string): ApiError => new ApiError(410, 'pageEnded', message),
  unsupportedType: (): ApiError =>
    new ApiError(415, 'unsupportedMediaType', 'Send this as application/json.'),
  unsupportedUpload: (): ApiError =>
    new ApiError(415, 'unsupportedMediaType', 'Send this as multipart/form-data.'),
  malformedJson: (): ApiError => new ApiError(400, 'malformedJson', 'That body is not JSON.'),
  fields: (fields: Fields, message?: string): ApiError =>
    new ApiError(
      422,
      'invalidFields',
      message ?? Object.values(fields)[0] ?? 'Check the fields.',
      fields,
    ),
  value: (message: string): ApiError => new ApiError(422, 'invalidFields', message),
  state: (message: string): ApiError => new ApiError(409, 'conflict', message),
  stale: (message: string): ApiError => new ApiError(412, 'stale', message),
  unavailable: (message: string): ApiError => new ApiError(503, 'serviceUnavailable', message),
};

export type Query = URLSearchParams;

export type DeskIdentity = { token: string; desk: { id: string; name: string; email: string } };

export type Context = {
  method: string;
  path: string;
  query: Query;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  cookies: Record<string, string>;
  request: IncomingMessage;
  response: ServerResponse;
  stateChanging: boolean;
  /** Set once the ladder has passed its authentication rung. */
  identity: DeskIdentity | null;
  /** Read before authentication, so a file over its limit answers 413 first. */
  upload: import('./upload.js').Upload | null;
};

export function requireIdentity(context: Context): DeskIdentity {
  if (context.identity === null) throw refuse.notSignedIn();
  return context.identity;
}

export function takeUpload(context: Context): import('./upload.js').Upload {
  if (context.upload === null) throw refuse.unsupportedUpload();
  return context.upload;
}

export type Reply = {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
};

export function readCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    cookies[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return cookies;
}

type BodyOutcome = { body: Record<string, unknown> } | { error: unknown };

const PARSED_BODIES = new WeakMap<Context, BodyOutcome>();

/**
 * A body limit is judged on Content-Length before the body is read. The outcome
 * is kept, so a rate limit that needs the body does not change what the handler
 * then answers.
 */
export async function readJsonBody(context: Context): Promise<Record<string, unknown>> {
  const already = PARSED_BODIES.get(context);
  if (already !== undefined) {
    if ('error' in already) throw already.error;
    return already.body;
  }
  try {
    const body = await parseJsonBody(context);
    PARSED_BODIES.set(context, { body });
    return body;
  } catch (error) {
    PARSED_BODIES.set(context, { error });
    throw error;
  }
}

async function parseJsonBody(context: Context): Promise<Record<string, unknown>> {
  const declared = Number(context.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > JSON_BODY_LIMIT) {
    throw refuse.tooLarge('That body is over 1,000,000 bytes.');
  }
  const type = String(context.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('application/json')) throw refuse.unsupportedType();
  const raw = await readRaw(context.request, JSON_BODY_LIMIT, 'That body is over 1,000,000 bytes.');
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw refuse.malformedJson();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw refuse.malformedJson();
  }
  return parsed as Record<string, unknown>;
}

/** Reads the body for a rate limit, leaving any refusal for the handler. */
export async function peekJsonBody(context: Context): Promise<Record<string, unknown>> {
  try {
    return await readJsonBody(context);
  } catch {
    return {};
  }
}

export function readRaw(
  request: IncomingMessage,
  limit: number,
  tooLargeMessage: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.destroy();
        reject(refuse.tooLarge(tooLargeMessage));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', () => reject(refuse.malformedJson()));
  });
}

const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function isStateChanging(method: string): boolean {
  return STATE_CHANGING.has(method);
}

/**
 * A state-changing request whose Origin differs from the app's own answers 403;
 * a request with no Origin is judged as same-origin.
 */
export function checkOrigin(context: Context): void {
  if (!context.stateChanging) return;
  const origin = context.headers['origin'];
  if (origin === undefined || origin === 'null') return;
  const host = context.headers['host'];
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw refuse.foreignOrigin();
  }
  if (originHost !== host) throw refuse.foreignOrigin();
}

export type RouteHandler = (context: Context) => Promise<Reply>;

/** Which limit a route's body is judged against before it is read. */
export type BodyKind = 'none' | 'json' | 'upload';

export type RouteSpec = {
  method: string;
  pattern: string;
  body?: BodyKind;
  auth?: 'desk' | 'open';
  /** The limit an upload route's file is judged against, before anything else. */
  uploadLimit?: (context: Context) => Promise<import('./upload.js').UploadLimit>;
  /** Spends or reads a rate window; throws the 429 of the ladder's third rung. */
  limit?: (context: Context, deskId: string | null) => Promise<void>;
  handler: RouteHandler;
};

type CompiledRoute = RouteSpec & { parts: string[] };

export class Router {
  private readonly routes: CompiledRoute[] = [];

  addAll(specs: readonly RouteSpec[]): this {
    for (const spec of specs) {
      this.routes.push({ ...spec, parts: spec.pattern.split('/').filter(Boolean) });
    }
    return this;
  }

  /** Unknown route or wrong method is the first rung of the ladder. */
  match(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } {
    const parts = path.split('/').filter(Boolean);
    const allow = new Set<string>();
    for (const route of this.routes) {
      const params = matchParts(route.parts, parts);
      if (params === null) continue;
      allow.add(route.method);
      if (route.method === method) return { route, params };
    }
    if (allow.size > 0) {
      allow.add('OPTIONS');
      throw refuse.methodNotAllowed([...allow].sort());
    }
    throw refuse.notFound();
  }
}

function matchParts(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index] as string;
    const actual = parts[index] as string;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
      headers: error.headers,
    };
  }
  process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
  return {
    status: 500,
    body: { error: { code: 'serverError', message: 'Something went wrong on the desk.' } },
  };
}
