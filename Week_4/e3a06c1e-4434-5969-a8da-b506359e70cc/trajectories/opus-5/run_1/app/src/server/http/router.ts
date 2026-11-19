import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BodyKind, MultipartBody } from './body.js';
import { ApiError } from './errors.js';

export interface Reply {
  readonly status: number;
  readonly json?: unknown;
  readonly bytes?: Buffer;
  readonly contentType?: string;
  readonly headers?: Record<string, string>;
  readonly handled?: true;
}

export const json = (status: number, value: unknown, headers?: Record<string, string>): Reply => ({
  status,
  json: value,
  ...(headers === undefined ? {} : { headers }),
});

export const empty = (status: number, headers?: Record<string, string>): Reply => ({
  status,
  ...(headers === undefined ? {} : { headers }),
});

export const bytes = (status: number, body: Buffer, contentType: string, headers?: Record<string, string>): Reply => ({
  status,
  bytes: body,
  contentType,
  ...(headers === undefined ? {} : { headers }),
});

export const handled: Reply = { status: 0, handled: true };

export interface Ctx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly search: URLSearchParams;
  readonly cookies: Readonly<Record<string, string>>;
  readonly origin: string;
  /** The parsed JSON body of routes declared with the `json` body kind. */
  readonly body: Readonly<Record<string, unknown>>;
  /** The parsed multipart body of routes declared with the `multipart` body kind. */
  readonly multipart: MultipartBody;
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

interface Segment {
  readonly literal: string | null;
  readonly param: string | null;
}

interface Route {
  readonly method: string;
  readonly segments: readonly Segment[];
  readonly handler: Handler;
  readonly bodyKind: BodyKind;
}

const parsePattern = (pattern: string): Segment[] =>
  pattern
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith(':') ? { literal: null, param: part.slice(1) } : { literal: part, param: null },
    );

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, bodyKind: BodyKind = 'none'): void {
    this.routes.push({ method, segments: parsePattern(pattern), handler, bodyKind });
  }

  match(
    method: string,
    path: string,
  ): { handler: Handler; params: Record<string, string>; bodyKind: BodyKind } | null {
    const parts = path.split('/').filter((part) => part.length > 0);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i] as Segment;
        const value = parts[i] as string;
        if (segment.param !== null) params[segment.param] = decodeURIComponent(value);
        else if (segment.literal !== value) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params, bodyKind: route.bodyKind };
    }
    return null;
  }
}

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
};

export const sendReply = (res: ServerResponse, reply: Reply): void => {
  if (reply.handled === true) return;
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (reply.json !== undefined) {
    const body = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = String(body.length);
    res.writeHead(reply.status, headers);
    res.end(body);
    return;
  }
  if (reply.bytes !== undefined) {
    headers['content-type'] = reply.contentType ?? 'application/octet-stream';
    headers['content-length'] = String(reply.bytes.length);
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
    return;
  }
  res.writeHead(reply.status, headers);
  res.end();
};

export const sendError = (res: ServerResponse, error: unknown): void => {
  const api =
    error instanceof ApiError
      ? error
      : new ApiError(500, 'internal_error', 'Something went wrong. Try again.');
  if (!(error instanceof ApiError)) console.error('unhandled request error', error);
  if (res.headersSent) {
    res.end();
    return;
  }
  sendReply(res, json(api.status, api.body()));
};
