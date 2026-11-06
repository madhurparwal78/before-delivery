import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ApiError } from './errors';

export const API_BODY_LIMIT = 1_000_000;
export const REVISION_BODY_LIMIT = 4_000_000;
export const MANIFEST_BODY_LIMIT = 5_000_000;

export interface Reply {
  status: number;
  headers?: Record<string, string | string[]>;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
}

export interface RequestContext {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  rawBody: Buffer;
  body: unknown;
  cookies: Record<string, string>;
}

export type Handler = (ctx: RequestContext) => Promise<Reply> | Reply;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  bodyLimit: number;
}

export function jsonReply(status: number, json: unknown, headers: Record<string, string | string[]> = {}): Reply {
  return { status, json, headers };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name.length > 0) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw new BodyTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export class Router {
  private readonly routes: Route[] = [];
  private fallback: Handler | null = null;

  add(method: string, pattern: string, handler: Handler, bodyLimit = API_BODY_LIMIT): void {
    this.routes.push({ method, segments: pattern.split('/').filter((part) => part.length > 0), handler, bodyLimit });
  }

  setFallback(handler: Handler): void {
    this.fallback = handler;
  }

  private match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split('/').filter((part) => part.length > 0);
    let pathMatched: Route | null = null;
    for (const route of this.routes) {
      const params: Record<string, string> = {};
      let matched = true;
      if (route.segments.length !== parts.length) {
        const tail = route.segments[route.segments.length - 1];
        if (!(tail === '*' && parts.length >= route.segments.length - 1)) continue;
      }
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index] ?? '';
        if (segment === '*') {
          params['*'] = parts.slice(index).join('/');
          break;
        }
        const part = parts[index];
        if (part === undefined) {
          matched = false;
          break;
        }
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(part);
        else if (segment !== part) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      pathMatched = route;
      if (route.method === method) return { route, params };
    }
    if (pathMatched) return { route: { ...pathMatched, handler: methodNotAllowed }, params: {} };
    return null;
  }

  private sameOrigin(req: IncomingMessage, publicUrl: string): boolean {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0 || origin === 'null') return true;
    const host = req.headers.host ?? '';
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : 'http';
    return origin === `${proto}://${host}` || origin === `http://${host}` || origin === `https://${host}` || origin === publicUrl;
  }

  listen(port: number, publicUrl: string, onError: (error: unknown) => void): Server {
    const server = createServer((req, res) => {
      void this.dispatch(req, res, publicUrl).catch((error) => {
        onError(error);
        if (!res.headersSent) {
          send(res, {
            status: 500,
            json: { error: { code: 'internal_error', message: 'Something went wrong.' } },
          });
        }
      });
    });
    server.listen(port, '0.0.0.0');
    return server;
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse, publicUrl: string): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const isApi = path === '/api' || path.startsWith('/api/');
    const matched = this.match(method, path);
    const handler = matched?.route.handler ?? this.fallback;

    try {
      const declaredLength = Number(req.headers['content-length'] ?? 0);
      const hasBody = declaredLength > 0 || req.headers['transfer-encoding'] !== undefined;
      if (isApi && hasBody) {
        const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
        if (contentType !== 'application/json') {
          throw new ApiError(415, 'unsupported_media_type', 'Send this request as application/json.');
        }
      }

      const limit = matched?.route.bodyLimit ?? API_BODY_LIMIT;
      let rawBody: Buffer;
      try {
        rawBody = hasBody ? await readBody(req, limit) : Buffer.alloc(0);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          throw new ApiError(413, 'payload_too_large', 'This request body is too large.');
        }
        throw error;
      }

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !this.sameOrigin(req, publicUrl)) {
        throw new ApiError(403, 'cross_origin', 'Cross-origin requests are refused.');
      }

      if (!handler) throw new ApiError(404, 'not_found', 'Not found.');

      let body: unknown;
      if (rawBody.length > 0 && isApi) {
        try {
          body = JSON.parse(rawBody.toString('utf8'));
        } catch {
          throw new ApiError(422, 'validation_failed', 'Some fields need attention.', {
            fields: { body: 'must be a JSON object' },
          });
        }
      }

      const reply = await handler({
        method,
        path,
        query: url.searchParams,
        params: matched?.params ?? {},
        headers: req.headers,
        rawBody,
        body,
        cookies: parseCookies(req.headers.cookie),
      });
      send(res, reply, method === 'HEAD');
    } catch (error) {
      if (error instanceof ApiError) {
        send(res, { status: error.status, json: error.body() }, method === 'HEAD');
        return;
      }
      throw error;
    }
  }
}

function methodNotAllowed(): Reply {
  return {
    status: 405,
    json: { error: { code: 'method_not_allowed', message: 'That method is not allowed here.' } },
  };
}

export function send(res: ServerResponse, reply: Reply, headOnly = false): void {
  const headers: Record<string, string | string[]> = { ...(reply.headers ?? {}) };
  let payload: Buffer;
  if (reply.json !== undefined) {
    payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['content-type'] = 'application/json; charset=utf-8';
  } else if (reply.body !== undefined) {
    payload = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body, 'utf8');
    if (reply.contentType) headers['content-type'] = reply.contentType;
  } else {
    payload = Buffer.alloc(0);
  }
  headers['content-length'] = String(payload.length);
  res.writeHead(reply.status, headers);
  res.end(headOnly ? undefined : payload);
}
