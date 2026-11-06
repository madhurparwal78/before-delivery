import type { IncomingHttpHeaders } from 'node:http';
import { invalidJson, methodNotAllowed, notFound, unsupportedMediaType } from './errors.js';

export interface Reply {
  readonly status: number;
  readonly json?: unknown;
  readonly body?: Buffer | string;
  readonly contentType?: string;
  readonly headers?: Record<string, string>;
}

export interface Ctx {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly params: Record<string, string>;
  readonly headers: IncomingHttpHeaders;
  readonly rawBody: Buffer;
  readonly cookies: Record<string, string>;
  readonly now: Date;
  readonly setCookies: string[];
}

export interface RouteOptions {
  /** Largest request body in bytes, and the limit reported on 413. */
  readonly fileLimitBytes?: number;
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

export interface Route {
  readonly segments: readonly string[];
  readonly methods: Record<string, Handler>;
  readonly allow: string;
  readonly options: RouteOptions;
}

export const JSON_BODY_LIMIT = 100_000;
export const MULTIPART_ENVELOPE_ALLOWANCE = 100_000;

export class Router {
  private readonly routes: Route[] = [];

  add(path: string, methods: Record<string, Handler>, options: RouteOptions = {}): void {
    const allow = Object.keys(methods).join(', ');
    this.routes.push({ segments: path.split('/').slice(1), methods, allow, options });
  }

  match(path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split('/').slice(1);
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (const [index, segment] of route.segments.entries()) {
        if (segment.startsWith(':')) {
          const value = decodeURIComponent(parts[index]);
          if (value === '') {
            matched = false;
            break;
          }
          params[segment.slice(1)] = value;
        } else if (segment !== parts[index]) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  resolve(method: string, path: string): { route: Route; params: Record<string, string> } {
    const found = this.match(path);
    if (found === null) throw notFound();
    if (!(method in found.route.methods)) throw methodNotAllowed(found.route.allow);
    return found;
  }
}

function contentTypeOf(headers: IncomingHttpHeaders): string {
  const raw = headers['content-type'];
  return Array.isArray(raw) ? raw[0] : (raw ?? '');
}

function mimeOf(headers: IncomingHttpHeaders): string {
  return contentTypeOf(headers).split(';')[0].trim().toLowerCase();
}

export function readJsonBody(ctx: Ctx): Record<string, unknown> {
  if (mimeOf(ctx.headers) !== 'application/json') throw unsupportedMediaType();
  if (ctx.rawBody.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.rawBody.toString('utf8'));
  } catch {
    throw invalidJson();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidJson();
  return parsed as Record<string, unknown>;
}

export function parseCookies(headers: IncomingHttpHeaders): Record<string, string> {
  const raw = headers.cookie;
  const header = Array.isArray(raw) ? raw[0] : raw;
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return cookies;
}

export function isMultipart(ctx: Ctx): boolean {
  return mimeOf(ctx.headers) === 'multipart/form-data';
}

export function multipartBoundary(ctx: Ctx): string | null {
  const contentType = contentTypeOf(ctx.headers);
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (match === null) return null;
  return (match[1] ?? match[2]).trim();
}
