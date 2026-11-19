import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, apiErrors } from './errors.js';

export interface Session {
  userId: string;
  displayName: string;
  email: string;
}

export class RequestContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly params: Record<string, string>;
  session: Session | null = null;
  private bodyRead = false;

  constructor(request: IncomingMessage, response: ServerResponse, url: URL, params: Record<string, string>) {
    this.request = request;
    this.response = response;
    this.url = url;
    this.params = params;
  }

  requireSession(): Session {
    if (this.session === null) throw apiErrors.unauthenticated();
    return this.session;
  }

  /** Reads the raw body, answering 413 before anything is parsed. */
  async readBytes(limit: number, overflow?: (size: number) => ApiError): Promise<Uint8Array> {
    if (this.bodyRead) throw new Error('the body was already read');
    this.bodyRead = true;
    const tooLarge = (size: number): ApiError =>
      overflow === undefined ? apiErrors.payloadTooLarge(limit) : overflow(size);
    // An oversized body is discarded rather than parsed, and the 413 is sent once the caller has
    // finished sending, so the answer always reaches it.
    const DRAIN_CEILING = 64 * 1024 * 1024;
    return await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let over = false;
      let settled = false;
      const settle = (work: () => void): void => {
        if (settled) return;
        settled = true;
        work();
      };
      this.request.on('data', (piece: Buffer) => {
        total += piece.length;
        if (total > limit) {
          over = true;
          chunks.length = 0;
          if (total > DRAIN_CEILING) {
            this.request.destroy();
            settle(() => reject(tooLarge(total)));
          }
          return;
        }
        chunks.push(piece);
      });
      this.request.on('end', () => {
        settle(() => {
          if (over) reject(tooLarge(total));
          else resolve(new Uint8Array(Buffer.concat(chunks)));
        });
      });
      this.request.on('error', (cause) => settle(() => reject(cause)));
    });
  }

  async readJson(limit: number): Promise<Record<string, unknown>> {
    const bytes = await this.readBytes(limit);
    if (bytes.length === 0) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      throw apiErrors.validation({ body: 'Send a JSON object.' });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw apiErrors.validation({ body: 'Send a JSON object.' });
    }
    return parsed as Record<string, unknown>;
  }

  json(status: number, body: unknown): void {
    const text = JSON.stringify(body);
    this.response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
    });
    this.response.end(text);
  }

  empty(status: number): void {
    this.response.writeHead(status, { 'cache-control': 'no-store' });
    this.response.end();
  }

  bytes(body: Uint8Array, headers: Record<string, string>): void {
    this.response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
      ...headers,
    });
    this.response.end(Buffer.from(body));
  }

  setCookie(value: string, maxAgeSeconds: number): void {
    this.response.setHeader(
      'set-cookie',
      `wb_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`,
    );
  }

  clearCookie(): void {
    this.response.setHeader('set-cookie', 'wb_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  }
}

export type Handler = (ctx: RequestContext) => Promise<void> | void;

export interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  /** Routes that work without a session. */
  open?: true;
}

interface CompiledRoute extends Route {
  segments: string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(method: string, pattern: string, handler: Handler, open?: true): void {
    this.routes.push({ method, pattern, handler, open, segments: pattern.split('/').filter((part) => part !== '') });
  }

  match(method: string, pathname: string): { route: CompiledRoute; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((part) => part !== '');
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i]!;
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[i]!);
        else if (segment !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }
}

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers['cookie'];
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** True when an unsafe request carries an Origin header from somewhere else. */
export function isCrossOrigin(request: IncomingMessage): boolean {
  const origin = request.headers['origin'];
  if (origin === undefined || origin === 'null') return false;
  const host = request.headers['host'];
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export function sendError(response: ServerResponse, error: ApiError): void {
  const text = JSON.stringify(error.body());
  response.writeHead(error.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  response.end(text);
}
