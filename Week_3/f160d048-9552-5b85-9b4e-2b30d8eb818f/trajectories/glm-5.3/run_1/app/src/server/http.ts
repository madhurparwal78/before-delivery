import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App, SessionUser } from '../lib/app.js';
import { ApiError, errors, errorBody } from '../lib/errors.js';

export interface RouteParams {
  [key: string]: string;
}

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  app: App;
  url: URL;
  user: SessionUser | null;
  body: unknown;
  params: RouteParams;
}

export type AuthLevel = 'member' | 'moderator' | 'team' | 'employerAdmin' | 'founder';

export interface Route {
  method: string;
  path: string;
  handler: (ctx: RouteContext) => Promise<void>;
  auth?: AuthLevel;
  raw?: boolean;
}

export function route(
  method: string,
  path: string,
  handler: (ctx: RouteContext) => Promise<void>,
  auth?: AuthLevel,
): Route {
  return { method, path, handler, auth };
}

export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, JSON_HEADERS);
  res.end(text);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof ApiError) {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    if (err.retryAfter !== undefined) headers['retry-after'] = String(Math.max(1, Math.ceil(err.retryAfter)));
    res.writeHead(err.status, headers);
    res.end(JSON.stringify(errorBody(err)));
    return;
  }
  console.error('unhandled error', err);
  res.writeHead(500, JSON_HEADERS);
  res.end(JSON.stringify({ error: 'internal_error', message: 'Something went wrong.' }));
}

// Reads up to maxBytes; a larger body answers 413 while it is being read.
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  const raw = await new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(errors.payloadTooLarge());
        // Drain the rest so the reply can be written and the client sees the 413.
        chunks.length = 0;
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (!settled) reject(errors.notFound());
    });
    req.on('aborted', () => {
      if (!settled) reject(errors.payloadTooLarge());
    });
  });
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw errors.validation({ _body: 'Check the highlighted fields.' });
  }
}

