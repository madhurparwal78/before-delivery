import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { ApiError, notFound, unauthenticated } from './errors.js';
import type { PersonRow } from '../data/people.js';

export const JSON_BODY_LIMIT = 65_536;
export const IMAGE_BODY_LIMIT = 5_000_000;

export type RouteResult =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'empty'; readonly status: number }
  | {
      readonly kind: 'binary';
      readonly status: number;
      readonly contentType: string;
      readonly body: Buffer;
      readonly filename?: string;
    };

export const json = (status: number, body: unknown): RouteResult => ({ kind: 'json', status, body });
export const empty = (status: number): RouteResult => ({ kind: 'empty', status });
export const binary = (
  contentType: string,
  body: Buffer,
  filename?: string,
): RouteResult =>
  filename === undefined
    ? { kind: 'binary', status: 200, contentType, body }
    : { kind: 'binary', status: 200, contentType, body, filename };

export interface RequestContext {
  readonly method: string;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: IncomingHttpHeaders;
  readonly body: Readonly<Record<string, unknown>>;
  readonly raw: Buffer;
  readonly person: PersonRow | null;
}

export type BodyMode = 'json' | 'image' | 'none';
export type AuthMode = 'required' | 'optional' | 'none';

export interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly auth: AuthMode;
  readonly body: BodyMode;
  readonly handle: (ctx: RequestContext) => Promise<RouteResult>;
}

interface CompiledRoute extends Route {
  readonly segments: readonly string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push({ ...route, segments: route.pattern.split('/').filter((s) => s !== '') });
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((s) => s !== '');
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i] as string;
        const value = parts[i] as string;
        if (segment.startsWith('{') && segment.endsWith('}')) {
          params[segment.slice(1, -1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method) return { route, params };
    }
    // An unknown /api path, and a known path with an unused method alike, are not found.
    void pathMatched;
    return null;
  }
}

export function readBearerKey(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? (match[1] as string) : null;
}

/**
 * Reads the body up to its limit. A larger body is drained rather than cut off, so the
 * caller still receives the 413 answer on the same connection.
 */
export async function readRawBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let overLimit = false;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    total += piece.length;
    if (total > limit) {
      overLimit = true;
      chunks.length = 0;
      if (total > limit * 4) {
        request.destroy();
        break;
      }
      continue;
    }
    chunks.push(piece);
  }
  if (overLimit) throw new ApiError(413, 'too_large');
  return Buffer.concat(chunks);
}

function baseContentType(headers: IncomingHttpHeaders): string | null {
  const value = headers['content-type'];
  if (typeof value !== 'string' || value.trim() === '') return null;
  return (value.split(';')[0] as string).trim().toLowerCase();
}

export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function parseJsonBody(raw: Buffer, headers: IncomingHttpHeaders): Record<string, unknown> {
  if (raw.length === 0) return {};
  const type = baseContentType(headers);
  if (type !== 'application/json') throw new ApiError(415, 'unsupported_media_type');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(400, 'bad_json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'bad_json');
  }
  return parsed as Record<string, unknown>;
}

export function imageContentType(headers: IncomingHttpHeaders): string {
  const type = baseContentType(headers);
  if (type === null || IMAGE_TYPES[type] === undefined) {
    throw new ApiError(415, 'unsupported_media_type');
  }
  return type;
}

export function requirePerson(ctx: RequestContext): PersonRow {
  if (ctx.person === null) throw unauthenticated();
  return ctx.person;
}

export { notFound };
