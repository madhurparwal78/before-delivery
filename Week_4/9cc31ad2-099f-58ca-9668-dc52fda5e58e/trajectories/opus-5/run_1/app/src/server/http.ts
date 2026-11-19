import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.js';

export const MAX_BODY_BYTES = 65536;
export const MAX_FINISH_BODY_BYTES = 1000000;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  rawBody: Buffer;
  playerId: string | null;
  sessionId: string | null;
}

export type Handler = (ctx: RequestContext) => Promise<void> | void;

export interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  maxBodyBytes?: number;
}

export interface MatchedRoute {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(routes: Route[], method: string, pathname: string): MatchedRoute | null {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  for (const route of routes) {
    if (route.method !== method) continue;
    const patternParts = route.pattern.split('/').filter((part) => part.length > 0);
    if (patternParts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < patternParts.length; index += 1) {
      const expected = patternParts[index]!;
      const actual = parts[index]!;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': payload.byteLength,
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body());
}

export function setSessionCookie(res: ServerResponse, sessionId: string): void {
  res.setHeader(
    'set-cookie',
    `kerb_session=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000`,
  );
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export class BodyTooLarge extends Error {}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  return await new Promise<Buffer>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > limit) {
        over = true;
        // Keep draining so the oversize request still gets its answer.
        if (size > limit * 4) {
          req.destroy();
          reject(new BodyTooLarge());
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => (over ? reject(new BodyTooLarge()) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export function parseJsonBody(ctx: RequestContext): Record<string, unknown> {
  if (ctx.rawBody.byteLength === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.rawBody.toString('utf8'));
  } catch {
    throw new ApiError(422, 'VALIDATION_FAILED', 'The request body is not valid JSON.', {
      body: 'Send a JSON object.',
    });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'The request body must be a JSON object.', {
      body: 'Send a JSON object.',
    });
  }
  return parsed as Record<string, unknown>;
}

const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function checkBoundary(req: IncomingMessage): void {
  const method = req.method ?? 'GET';
  if (STATE_CHANGING.has(method)) {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== 'null') {
      const host = req.headers.host ?? '';
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost !== host) {
        throw new ApiError(403, 'FORBIDDEN_ORIGIN', 'This request came from another origin.');
      }
    }
  }
  if (method === 'POST' || method === 'PATCH') {
    const contentType = req.headers['content-type'] ?? '';
    const mediaType = contentType.split(';')[0]!.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send application/json.');
    }
  }
}
