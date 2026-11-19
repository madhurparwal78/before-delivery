/**
 * One request's context: its address, its body, its desk and the helpers every
 * handler uses to answer.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App } from '../app.ts';
import type { Row } from '../present.ts';
import { F } from '../../shared/feedback.ts';
import { fail } from './errors.ts';
import type { JsonObject, Multipart } from './request.ts';
import {
  clearedSessionCookie,
  readCookie,
  SESSION_COOKIE,
  sendBytes,
  sendJson,
  sendNoContent,
  sendText,
  sessionCookie,
} from './respond.ts';

export interface Desk {
  id: string;
  name: string;
  email: string;
}

export class Ctx {
  readonly params: Record<string, string> = {};
  /** Set once the route's body has been read. */
  body: JsonObject = {};
  multipart: Multipart | null = null;
  /** Whatever the route's resolver found, for the handler to use. */
  resolved: Record<string, Row> = {};
  private deskRow: Desk | null = null;

  constructor(
    readonly app: App,
    readonly request: IncomingMessage,
    readonly response: ServerResponse,
    readonly url: URL,
  ) {}

  get method(): string {
    return this.request.method ?? 'GET';
  }

  get path(): string {
    return this.url.pathname;
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  param(name: string): string {
    const value = this.params[name];
    if (value === undefined) throw fail.notFound();
    return value;
  }

  /** The session's desk, or null when there is none. */
  get desk(): Desk | null {
    return this.deskRow;
  }

  /** The session's desk; only called on routes that require one. */
  requireDesk(): Desk {
    if (!this.deskRow) throw fail.notSignedIn('Sign in to use the desk.');
    return this.deskRow;
  }

  /**
   * Reads the session cookie. A cookie whose session has run out reads
   * `sessionEnded`, so the screen can keep what was typed.
   */
  async resolveSession(): Promise<void> {
    const token = readCookie(this.request.headers.cookie, SESSION_COOKIE);
    if (!token) return;
    const row = await this.app.db.one<Row>(
      `SELECT s.id, s.ends_at, d.id AS desk_id, d.name, d.email
         FROM sessions s JOIN desks d ON d.id = s.desk_id WHERE s.id = $1`,
      [token],
    );
    if (!row) {
      this.sessionState = 'ended';
      return;
    }
    if (new Date(row.ends_at as string).getTime() <= this.app.now()) {
      this.sessionState = 'ended';
      return;
    }
    this.deskRow = { id: String(row.desk_id), name: String(row.name), email: String(row.email) };
    this.sessionState = 'live';
  }

  sessionState: 'none' | 'live' | 'ended' = 'none';

  /** The 401 the published order calls for, by what the cookie said. */
  authFailure(): never {
    if (this.sessionState === 'ended') throw fail.sessionEnded(F.sessionEnded);
    throw fail.notSignedIn('Sign in to use the desk.');
  }

  setSessionCookie(token: string): void {
    this.response.setHeader('set-cookie', sessionCookie(token));
  }

  clearSessionCookie(): void {
    this.response.setHeader('set-cookie', clearedSessionCookie());
  }

  json(status: number, body: unknown): void {
    sendJson(this.response, status, body);
  }

  noContent(): void {
    sendNoContent(this.response);
  }

  bytes(bytes: Uint8Array, contentType: string, fileName?: string): void {
    sendBytes(
      this.response,
      200,
      bytes,
      contentType,
      fileName ? { 'content-disposition': `attachment; filename="${fileName}"` } : {},
    );
  }

  text(status: number, text: string, contentType: string, headers: Record<string, string> = {}): void {
    sendText(this.response, status, text, contentType, headers);
  }

  /** The base the private address is built on. */
  publicBase(): string {
    if (this.app.config.publicUrl) return this.app.config.publicUrl.replace(/\/+$/, '');
    const host = this.request.headers.host ?? `127.0.0.1:${this.app.config.port}`;
    return `http://${host}`;
  }
}

export type Handler = (ctx: Ctx) => Promise<void>;

export interface Route {
  method: string;
  /** `/api/pieces/:id/pins`, with `:name` for a captured part. */
  pattern: string;
  auth: 'required' | 'none';
  body?: 'json' | 'photograph' | 'workbook';
  /**
   * Runs after authentication and before the content type is checked, so an
   * unknown resource answers 404 whatever the request carried.
   */
  resolve?: Handler;
  /** Runs before authentication, for the limits the published order puts there. */
  rateLimit?: Handler;
  handle: Handler;
}

interface CompiledRoute extends Route {
  readonly parts: readonly string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push({ ...route, parts: route.pattern.split('/') });
  }

  addAll(routes: readonly Route[]): void {
    for (const route of routes) this.add(route);
  }

  /** The route for this address, or the methods it does allow. */
  match(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } | string[] {
    const parts = path.split('/');
    const allowed = new Set<string>();
    for (const route of this.routes) {
      if (route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.parts.length; i += 1) {
        const expected = route.parts[i]!;
        const actual = parts[i]!;
        if (expected.startsWith(':')) {
          if (actual.length === 0) {
            ok = false;
            break;
          }
          params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      allowed.add(route.method);
      if (route.method === method) return { route, params };
    }
    return [...allowed];
  }
}
