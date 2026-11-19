import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, notFound, tooLarge, unauthorized } from './errors.js';
import { JSON_BODY_MAX, MULTIPART_OVERHEAD, env } from './env.js';
import { one } from './db.js';

export interface Viewer {
  id: number;
  name: string;
  handle: string;
  email: string;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  viewer: Viewer | null;
  body: unknown;
}

export type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  auth: boolean;
  raw: boolean;
}

const routes: Route[] = [];

export function route(
  method: string,
  pattern: string,
  handler: Handler,
  options: { auth?: boolean; raw?: boolean } = {},
): void {
  routes.push({
    method,
    segments: pattern.split('/').filter((part) => part.length > 0),
    handler,
    auth: options.auth !== false,
    raw: options.raw === true,
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(tooLarge(limit));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > JSON_BODY_MAX) throw tooLarge(JSON_BODY_MAX);
  const raw = await readBody(req, JSON_BODY_MAX);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return {};
  }
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader(
    'set-cookie',
    `ml_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('set-cookie', 'ml_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export async function viewerFromRequest(req: IncomingMessage): Promise<Viewer | null> {
  const token = cookies(req).ml_session;
  if (!token) return null;
  return one<Viewer>(
    `select u.id, u.name, u.handle, u.email
       from sessions s join users u on u.id = s.user_id
      where s.token = $1`,
    [token],
  );
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = req.headers.host ?? '';
    if (parsed.host === host) return true;
    return parsed.host === new URL(env.publicUrl).host && host === new URL(env.publicUrl).host;
  } catch {
    return false;
  }
}

function match(route: Route, method: string, segments: string[]): Record<string, string> | null {
  if (route.method !== method) return null;
  if (route.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < segments.length; index += 1) {
    const pattern = route.segments[index];
    if (pattern.startsWith(':')) {
      params[pattern.slice(1)] = decodeURIComponent(segments[index]);
    } else if (pattern !== segments[index]) {
      return null;
    }
  }
  return params;
}

export async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET';
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  for (const candidate of routes) {
    const params = match(candidate, method, segments);
    if (!params) continue;
    await run(candidate, req, res, url, params);
    return true;
  }
  return false;
}

async function run(
  current: Route,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  params: Record<string, string>,
): Promise<void> {
  try {
    const viewer = await viewerFromRequest(req);
    if (current.auth && !viewer) throw unauthorized();
    let body: unknown = {};
    if (!current.raw && (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT')) {
      body = await readJson(req);
    }
    await current.handler({ req, res, url, params, viewer, body });
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, error.body);
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendJson(res, 500, { error: 'server_error' });
  }
}

export function requireViewer(ctx: Ctx): Viewer {
  if (!ctx.viewer) throw unauthorized();
  return ctx.viewer;
}

export function numericParam(ctx: Ctx, name: string): number {
  const value = Number(ctx.params[name]);
  if (!Number.isInteger(value) || value <= 0) throw notFound();
  return value;
}

export const MULTIPART_LIMIT = env.limits.imageMaxBytes + MULTIPART_OVERHEAD;
