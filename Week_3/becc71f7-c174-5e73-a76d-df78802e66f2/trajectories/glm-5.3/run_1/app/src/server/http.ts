// HTTP plumbing: the one place the error-precedence ladder is applied (DP-54).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, errors } from './errors.js';
import { toZ } from '../shared/time.js';

export interface RouteContext {
  method: string;
  path: string;
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  services: import('./services.js').Services;
  member: { id: string; name: string; email: string; role: string } | null;
  sessionToken: string | null;
  /** Raw body bytes; null when the route declares no body. */
  body: Buffer | null;
  /** Parsed JSON, cached on first read. */
  json: unknown | undefined;
}

export interface Route {
  method: string;
  pattern: string;
  bodyLimit: number;
  auth: import('./auth.js').Auth;
  handle: (ctx: RouteContext) => Promise<void> | void;
}

export function matchRoute(routes: Route[], method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  if (!pattern.includes(':')) {
    return pattern === path ? {} : null;
  }
  const pp = pattern.split('/');
  const xp = path.split('/');
  if (pp.length !== xp.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const p = pp[i]!;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(xp[i]!);
    else if (p !== xp[i]) return null;
  }
  return params;
}

export function methodsOf(routes: Route[], path: string): string[] {
  const allowed = new Set<string>();
  for (const route of routes) {
    if (matchPattern(route.pattern, path)) allowed.add(route.method);
  }
  return [...allowed];
}

export async function readBody(req: IncomingMessage, limit: number, res: ServerResponse): Promise<Buffer | null> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      total += chunk.length;
      if (total > limit) {
        over = true;
        chunks.length = 0;
        // Answer 413 as JSON, never a dropped connection (Server boundary).
        reject(new ApiError(413, 'payload_too_large', 'The request body is over its size limit.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
    void res;
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(text)),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendError(res: ServerResponse, err: ApiError): void {
  sendJson(res, err.status, JSON.parse(err.body()), err.headers);
}

export function parseJsonBody(ctx: RouteContext): unknown {
  if (ctx.json !== undefined) return ctx.json;
  if (ctx.body === null || ctx.body.length === 0) {
    throw errors.malformedJson();
  }
  try {
    ctx.json = JSON.parse(ctx.body.toString('utf8'));
  } catch {
    throw errors.malformedJson();
  }
  return ctx.json;
}

export function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.malformedJson();
  }
  return value as Record<string, unknown>;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function instantOf(value: unknown): Date | 'invalid' {
  if (typeof value !== 'string') return 'invalid';
  const t = Date.parse(value);
  if (Number.isNaN(t)) return 'invalid';
  return new Date(t);
}

export function wholeSeconds(date: Date): string {
  return toZ(date);
}
