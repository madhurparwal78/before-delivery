import type { IncomingHttpHeaders } from 'node:http';
import type { WebSocket } from 'ws';
import { JSON_LIMIT_BYTES } from './config.ts';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A signed-in person. `session` identifies the browser context (the hash of its cookie token). */
export interface User { username: string; session: string }

/** A finished answer: status, headers and body bytes. Handlers build it with `ctx.reply`. */
export interface Reply { status: number; headers: Record<string, string>; body: Buffer }

export interface RequestContext {
  readonly method: string;
  readonly path: string;
  /** values of the `:name` segments of the route pattern, already URL-decoded */
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  /** the signed-in person; always set on a route that is not `public`, null on a public route without a session */
  readonly user: User | null;
  /** The body parsed as JSON (an empty body reads as `{}`); `invalid` when it is not JSON. The body was read within the route's limit. */
  json(): unknown;
  /** The body bytes, read within the route's `bodyLimit`. */
  rawBody(): Buffer;
  /** A JSON answer; a `Buffer` body is sent as bytes with the given headers; `undefined` sends no body. */
  reply(status: number, body?: unknown, headers?: Record<string, string>): Reply;
}

export type Handler = (ctx: RequestContext) => Promise<Reply>;

export interface RouteOptions {
  /** Answers without a session. `ctx.user` is still set when the request carries a valid one. */
  access?: 'public';
  /** The most body bytes; a longer body answers `too_large` before anything else. Default: the 1 000 000 byte JSON limit. */
  bodyLimit?: number;
}

/** What a live-channel route hands back once the person may open it: it receives the upgraded socket. */
export interface SocketAdmission { attach(socket: WebSocket): void }
export type SocketHandler = (ctx: RequestContext) => Promise<SocketAdmission>;

interface Entry<H> { method: Method; segments: string[]; handler: H; options: RouteOptions }
export interface Match<H> { handler: H; access: RouteOptions['access']; bodyLimit: number; params: Record<string, string> }

const routes: Entry<Handler>[] = [];
const socketRoutes: Entry<SocketHandler>[] = [];

const split = (path: string): string[] => path.split('/').filter((segment) => segment !== '');

/** Registers an HTTP route. `pattern` has literal segments and `:name` parameters, for example `/api/drawings/:id/ops`. */
export function route(method: Method, pattern: string, handler: Handler, options: RouteOptions = {}): void {
  routes.push({ method, segments: split(pattern), handler, options });
}

/** Registers a live-channel route (`GET` with a WebSocket upgrade). */
export function socketRoute(pattern: string, handler: SocketHandler, options: RouteOptions = {}): void {
  socketRoutes.push({ method: 'GET', segments: split(pattern), handler, options });
}

/** A parameter that is not valid percent-encoding, or that decodes to a null character (PostgreSQL cannot look one up), is kept as it was sent; it will simply match no id. */
function decodeAll(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([name, value]) => {
    try {
      const decoded = decodeURIComponent(value);
      return [name, decoded.includes('\0') ? value : decoded];
    } catch {
      return [name, value];
    }
  }));
}

function find<H>(table: Entry<H>[], method: string, path: string): Match<H> | null {
  const parts = split(path);
  for (const entry of table) {
    if (entry.method !== method || entry.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const matches = entry.segments.every((segment, i) => {
      if (!segment.startsWith(':')) return segment === parts[i];
      params[segment.slice(1)] = parts[i];
      return true;
    });
    if (matches) {
      return { handler: entry.handler, access: entry.options.access, bodyLimit: entry.options.bodyLimit ?? JSON_LIMIT_BYTES, params: decodeAll(params) };
    }
  }
  return null;
}

export const matchRoute = (method: string, path: string): Match<Handler> | null => find(routes, method, path);
export const matchSocketRoute = (path: string): Match<SocketHandler> | null => find(socketRoutes, 'GET', path);
