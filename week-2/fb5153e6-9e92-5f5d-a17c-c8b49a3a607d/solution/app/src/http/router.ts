import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Locale } from '../shared/locale.js';
import { localeFromLang } from '../shared/locale.js';
import { parseCookies } from './cookies.js';
import type { MultipartForm } from './body.js';
import type { Session } from '../domain/session.js';

export type Surface = 'api' | 'page' | 'media' | 'read-api';
export type BodyKind = 'none' | 'json' | 'multipart';

export interface Reply {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly cookies?: readonly string[];
  readonly json?: unknown;
  readonly html?: string;
  readonly text?: string;
  readonly bytes?: Buffer;
  readonly contentType?: string;
  readonly location?: string;
}

export function json(status: number, value: unknown, extra: Partial<Reply> = {}): Reply {
  return { status, json: value, ...extra };
}

export function html(status: number, markup: string, extra: Partial<Reply> = {}): Reply {
  return { status, html: markup, ...extra };
}

export function empty(status: number, extra: Partial<Reply> = {}): Reply {
  return { status, ...extra };
}

export function redirect(location: string, status = 303): Reply {
  return { status, location };
}

export function bytes(
  status: number,
  contentType: string,
  body: Buffer,
  extra: Partial<Reply> = {},
): Reply {
  return { status, contentType, bytes: body, ...extra };
}

export interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly url: URL;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  /** The address's raw `lang` value, kept on internal links and redirects. */
  readonly lang: string | null;
  readonly locale: Locale;
  readonly cookies: Readonly<Record<string, string>>;
  readonly surface: Surface;
  readonly rawBody: Buffer;
  readonly body: Record<string, unknown>;
  readonly form: MultipartForm | null;
  readonly idempotencyKey: string | null;
  session: Session | null;
}

export interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly surface: Surface;
  readonly body: BodyKind;
  /** Query parameters this route accepts; anything else answers `unknown_parameter`. */
  readonly query?: readonly string[];
  /** JSON body fields this route accepts; anything else answers the unknown-field 422. */
  readonly fields?: readonly string[];
  readonly needsIdempotency?: boolean;
  readonly handler: (ctx: RequestContext) => Promise<Reply>;
}

interface CompiledRoute extends Route {
  readonly segments: readonly string[];
}

/**
 * A path parameter that isn't valid percent-encoding, or that decodes to a NUL
 * byte, names nothing the store can hold: the route doesn't match, so the
 * address answers as an unknown path before any lookup.
 */
function decodeParam(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes('\u0000') ? null : decoded;
  } catch {
    return null;
  }
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push({ ...route, segments: route.pattern.split('/').filter((s) => s !== '') });
  }

  /** Matches on path first, so an unknown path is 404 and a wrong method is 405. */
  match(
    method: string,
    path: string,
  ): { route: Route; params: Record<string, string> } | { allow: readonly string[] } | null {
    const parts = path.split('/').filter((s) => s !== '');
    const pathMatches: CompiledRoute[] = [];
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i += 1) {
        const segment = route.segments[i] ?? '';
        const value = parts[i] ?? '';
        if (segment.startsWith(':')) {
          const decoded = decodeParam(value);
          if (decoded === null) {
            ok = false;
            break;
          }
          params[segment.slice(1)] = decoded;
        } else if (segment !== value) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatches.push(route);
      if (route.method === method) return { route, params };
    }
    if (pathMatches.length === 0) return null;
    return { allow: [...new Set(pathMatches.map((r) => r.method))] };
  }
}

export function contextBase(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Pick<RequestContext, 'req' | 'res' | 'method' | 'url' | 'path' | 'query' | 'lang' | 'locale' | 'cookies'> {
  const lang = url.searchParams.get('lang');
  return {
    req,
    res,
    method: (req.method ?? 'GET').toUpperCase(),
    url,
    path: url.pathname,
    query: url.searchParams,
    lang,
    locale: localeFromLang(lang),
    cookies: parseCookies(req.headers.cookie),
  };
}
