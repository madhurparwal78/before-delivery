import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BODY_LIMIT, PHOTO_BODY_LIMIT } from '../config';
import { AppError, databaseUnavailable, identityUnavailable, refuse } from './errors';
import { send, sendJson, sendNoContent, sendNotFound, sendRefusal } from './respond';
import { DatabaseUnreachable } from '../db/pool';
import { IdentityUnreachable } from '../services/keycloak';
import type { Ctx, Handler, Reply } from '../api/types';
import { resolveCaller } from '../api/session';

/** What a route accepts as its request body. */
export type BodyKind = 'none' | 'json' | 'photo';

export interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly handler: Handler;
  readonly body: BodyKind;
  /** `false` for the three addresses that need no caller. */
  readonly needsCaller: boolean;
}

interface CompiledRoute extends Route {
  readonly segments: readonly string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push({ ...route, segments: route.pattern.split('/').filter((part) => part !== '') });
  }

  /** The endpoint table is the whole API: anything else is simply not there. */
  match(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } | null {
    const parts = path.split('/').filter((part) => part !== '');
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i] as string;
        const value = parts[i] as string;
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
        else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }
}

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) return 'too_large';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    total += piece.length;
    if (total > limit) return 'too_large';
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function contentTypeOf(request: IncomingMessage): string {
  const raw = request.headers['content-type'];
  if (typeof raw !== 'string') return '';
  const semicolon = raw.indexOf(';');
  return (semicolon === -1 ? raw : raw.slice(0, semicolon)).trim().toLowerCase();
}

/**
 * Transport refusals rank above everything else: 413 first, then 415. A photo
 * whose bytes do not carry its declared type's signature is a 415 at this rank.
 */
function checkTransport(request: IncomingMessage, kind: BodyKind, body: Buffer): void {
  if (kind === 'json') {
    if (body.length === 0) return;
    const type = contentTypeOf(request);
    if (type !== 'application/json') throw refuse('unsupported_media');
    return;
  }
  if (kind === 'photo') {
    const type = contentTypeOf(request);
    if (type !== 'image/jpeg' && type !== 'image/png') throw refuse('unsupported_media');
    const signature = type === 'image/jpeg' ? JPEG_SIGNATURE : PNG_SIGNATURE;
    if (!body.subarray(0, signature.length).equals(signature)) throw refuse('unsupported_media');
  }
}

function writeReply(response: ServerResponse, reply: Reply, cookie: string | null | undefined): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (cookie !== undefined && cookie !== null) headers['set-cookie'] = cookie;
  if (reply.status === 204) {
    sendNoContent(response, headers);
    return;
  }
  if (reply.body !== undefined) {
    send(response, reply.status, reply.contentType ?? 'application/octet-stream', reply.body, headers);
    return;
  }
  sendJson(response, reply.status, reply.json, headers);
}

export async function handleApi(
  router: Router,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const matched = router.match(request.method ?? 'GET', url.pathname);
  if (matched === null) {
    sendNotFound(response);
    return;
  }
  const { route, params } = matched;
  let cookie: string | null | undefined;
  try {
    const limit = route.body === 'photo' ? PHOTO_BODY_LIMIT : JSON_BODY_LIMIT;
    const body = route.body === 'none' ? Buffer.alloc(0) : await readBody(request, limit);
    if (body === 'too_large') throw refuse('too_large');
    checkTransport(request, route.body, body);

    const caller = await resolveCaller(request);
    if (route.needsCaller) {
      const methodAllowsCookie = request.method === 'GET';
      if (caller === null || (caller.fromCookie && !methodAllowsCookie)) throw refuse('unauthenticated');
    }

    const ctx: Ctx = {
      method: request.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      params,
      headers: request.headers,
      rawBody: body,
      caller: caller === null ? null : caller.account,
      response,
      now: new Date(),
      setCookie: (value) => {
        cookie = value;
      },
    };
    const reply = await route.handler(ctx);
    writeReply(response, reply, cookie);
  } catch (cause) {
    if (cause instanceof AppError) {
      sendRefusal(response, cause);
      return;
    }
    if (cause instanceof DatabaseUnreachable) {
      sendRefusal(response, databaseUnavailable());
      return;
    }
    if (cause instanceof IdentityUnreachable) {
      sendRefusal(response, identityUnavailable());
      return;
    }
    process.stderr.write(`unhandled: ${String(cause instanceof Error ? cause.stack : cause)}\n`);
    sendJson(response, 500, { error: 'wrong_state', message: 'That cannot be done in the current state.' });
  }
}
