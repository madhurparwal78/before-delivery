import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Json } from '../shared/canonical.js';
import { MAX_JSON_BYTES, MAX_UPLOAD_BYTES } from '../shared/uploads.js';
import { fieldCopy } from '../shared/copy.js';
import { Fault, faults } from './errors.js';
import { accountForSession, parseCookies, type Account } from './auth.js';

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
  handled?: boolean;
}

export class Ctx {
  readonly params: Record<string, string> = {};

  private cachedAccount: Account | null = null;

  private accountResolved = false;

  private cachedBody: Json | undefined;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly url: URL,
    readonly rawBody: Uint8Array,
  ) {}

  get method(): string {
    return this.req.method ?? 'GET';
  }

  get path(): string {
    return this.url.pathname;
  }

  get sessionId(): string | null {
    return parseCookies(this.req.headers.cookie)['rw_session'] ?? null;
  }

  async account(): Promise<Account | null> {
    if (this.accountResolved) return this.cachedAccount;
    this.accountResolved = true;
    const sessionId = this.sessionId;
    this.cachedAccount = sessionId ? await accountForSession(sessionId) : null;
    return this.cachedAccount;
  }

  async requireAccount(): Promise<Account> {
    const account = await this.account();
    if (!account) throw faults.unauthenticated();
    return account;
  }

  body(): Record<string, Json> {
    if (this.cachedBody === undefined) {
      if (this.rawBody.length === 0) this.cachedBody = {};
      else {
        try {
          this.cachedBody = JSON.parse(new TextDecoder().decode(this.rawBody)) as Json;
        } catch {
          throw faults.validation({ body: 'Send a JSON object.' });
        }
      }
    }
    const parsed = this.cachedBody;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw faults.validation({ body: 'Send a JSON object.' });
    return parsed as Record<string, Json>;
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD';
  pattern: string;
  handler: Handler;
  /** Public routes need no session. */
  open?: boolean;
  /** Raw routes take bytes instead of JSON. */
  raw?: boolean;
}

interface CompiledRoute extends Route {
  segments: string[];
}

export function compile(routes: readonly Route[]): CompiledRoute[] {
  return routes.map((route) => ({ ...route, segments: route.pattern.split('/').filter(Boolean) }));
}

export function matchRoute(
  routes: readonly CompiledRoute[],
  method: string,
  path: string,
): { route: CompiledRoute; params: Record<string, string> } | null {
  const parts = path.split('/').filter(Boolean);
  let pathExists = false;
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const segment = route.segments[index];
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[index]);
      else if (segment !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    pathExists = true;
    const wanted = method === 'HEAD' ? 'GET' : method;
    if (route.method === wanted) return { route, params };
  }
  if (pathExists) return null;
  return null;
}

export function ok(body: unknown): Reply {
  return { status: 200, body };
}

export function created(body: unknown): Reply {
  return { status: 201, body };
}

export function noContent(): Reply {
  return { status: 204 };
}

export function raw(
  bytes: Uint8Array,
  contentType: string,
  headers: Record<string, string> = {},
): Reply {
  return { status: 200, bytes, contentType, headers };
}

export function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(
          new Fault(
            413,
            'payload_too_large',
            limit === MAX_UPLOAD_BYTES ? fieldCopy.uploadTooLarge : 'This request body is too large.',
          ),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', (error) => reject(error));
    req.on('aborted', () => reject(new Fault(499, 'client_closed', 'The client left.')));
  });
}

export function bodyLimitFor(isUpload: boolean): number {
  return isUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES;
}

export function declaredLength(req: IncomingMessage): number | null {
  const header = req.headers['content-length'];
  if (typeof header !== 'string') return null;
  const value = Number(header);
  return Number.isFinite(value) ? value : null;
}

export function isJsonContentType(req: IncomingMessage): boolean {
  const header = req.headers['content-type'];
  if (typeof header !== 'string' || header === '') return false;
  return header.split(';')[0].trim().toLowerCase() === 'application/json';
}
