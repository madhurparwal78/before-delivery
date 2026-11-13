import type { RequestContext, ApiResponse } from './context.js';
import { forbidden, methodNotAllowed, notFound, unsupportedMediaType } from './errors.js';
import { MAX_JSON_BYTES } from '../../shared/shop.js';
import type { Role } from '../../shared/options.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Access = 'public' | 'staff' | 'desk' | 'owner' | 'books';
export type Expects = 'json' | 'multipart' | 'csv' | 'none';

type Hook = (ctx: RequestContext) => Promise<void>;

export interface RouteSpec<Resolved> {
  method: Method;
  path: string;
  access: Access;
  /** The body size limit; JSON bodies are at most 65,536 bytes. */
  bodyLimit?: number;
  expects?: Expects;
  /** A rate limit whose key is known before authentication. */
  earlyLimit?: Hook;
  /** A rate limit whose key is the signed-in member. */
  lateLimit?: Hook;
  /** Step 5: the resource named in the path or by a private token. */
  resolve?: (ctx: RequestContext) => Promise<Resolved>;
  handle: (ctx: RequestContext, resolved: Resolved) => Promise<ApiResponse>;
}

export interface CompiledRoute {
  method: Method;
  path: string;
  segments: string[];
  access: Access;
  bodyLimit: number;
  expects: Expects;
  earlyLimit: Hook | null;
  lateLimit: Hook | null;
  resolve: ((ctx: RequestContext) => Promise<unknown>) | null;
  handle: (ctx: RequestContext, resolved: unknown) => Promise<ApiResponse>;
}

export function route<Resolved>(spec: RouteSpec<Resolved>): CompiledRoute {
  const { resolve, handle } = spec;
  return {
    method: spec.method,
    path: spec.path,
    segments: spec.path.split('/').filter((segment) => segment !== ''),
    access: spec.access,
    bodyLimit: spec.bodyLimit ?? MAX_JSON_BYTES,
    expects: spec.expects ?? (spec.method === 'GET' || spec.method === 'DELETE' ? 'none' : 'json'),
    earlyLimit: spec.earlyLimit ?? null,
    lateLimit: spec.lateLimit ?? null,
    resolve: resolve === undefined ? null : (ctx) => resolve(ctx),
    handle: (ctx, resolved) => handle(ctx, resolved as Resolved),
  };
}

const ACCESS_ROLES: Record<Exclude<Access, 'public'>, readonly Role[]> = {
  staff: ['owner', 'assistant', 'bookkeeper'],
  desk: ['owner', 'assistant'],
  owner: ['owner'],
  books: ['owner', 'bookkeeper'],
};

/** Step 6: role. */
export function requireAccess(ctx: RequestContext, access: Access): void {
  if (access === 'public') return;
  const member = ctx.signedInMember();
  if (!ACCESS_ROLES[access].includes(member.role)) throw forbidden();
}

/** Step 7: content type. */
export function requireContentType(ctx: RequestContext, expects: Expects): void {
  if (expects === 'none') return;
  const raw = (ctx.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const wanted =
    expects === 'json'
      ? 'application/json'
      : expects === 'multipart'
        ? 'multipart/form-data'
        : 'text/csv';
  if (raw !== wanted) throw unsupportedMediaType(wanted);
}

export interface Match {
  route: CompiledRoute;
  params: Record<string, string>;
}

export class Router {
  constructor(private readonly routes: readonly CompiledRoute[]) {}

  /** Step 1: unknown route (404), or a wrong method (405 with an `Allow` header). */
  match(method: string, pathname: string): Match {
    const segments = splitPath(pathname);
    // A literal segment beats a parameter, so `/api/pieces/lookup` is not a piece id.
    const samePath = this.routes
      .filter((candidate) => matchSegments(candidate.segments, segments) !== null)
      .sort((left, right) => parameterCount(left) - parameterCount(right));
    if (samePath.length === 0) throw notFound();
    const found = samePath.find((candidate) => candidate.method === method);
    if (found === undefined) {
      throw methodNotAllowed([...new Set(samePath.map((candidate) => candidate.method))].sort());
    }
    return { route: found, params: matchSegments(found.segments, segments) ?? {} };
  }

}

function parameterCount(route: CompiledRoute): number {
  return route.segments.filter((segment) => segment.startsWith(':')).length;
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment !== '');
}

function matchSegments(
  pattern: readonly string[],
  segments: readonly string[],
): Record<string, string> | null {
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index] as string;
    const actual = segments[index] as string;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}
