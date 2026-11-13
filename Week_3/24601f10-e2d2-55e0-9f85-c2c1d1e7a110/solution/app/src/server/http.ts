import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { userFor, type User } from './auth.js';
import { config } from './config.js';
import { isReady } from './db.js';
import { ApiError, fail } from './errors.js';
import { MSG } from './messages.js';

export interface UploadedFile { name: string; bytes: Buffer }

export interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  user: User | null;
  json: () => Record<string, unknown>;
  file: () => Promise<UploadedFile>;
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer;
}

type Handler = (ctx: Ctx) => Promise<Reply>;
type Upload = 'roster' | 'logo';
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler; auth: boolean; upload?: Upload }

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, options: { auth?: boolean; upload?: Upload } = {}): void {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key: string) => { keys.push(key); return '([^/]+)'; })}$`);
  routes.push({ method, pattern, keys, handler, auth: options.auth ?? true, upload: options.upload });
}

export const ok = (body: unknown, status = 200, headers?: Record<string, string>): Reply => ({ status, body, headers });
export const noContent = (headers?: Record<string, string>): Reply => ({ status: 204, headers });

const JSON_TYPE = 'application/json; charset=utf-8';

function send(res: ServerResponse, status: number, headers: Record<string, string>, body?: Buffer | string): void {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers });
  res.end(body);
}

function sendError(res: ServerResponse, error: ApiError): void {
  send(res, error.status, { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store' }, JSON.stringify(error.body()));
}

// Read the body, refusing it with 413 as soon as it passes the limit.
async function readBody(req: IncomingMessage, limit: number, tooLarge: () => ApiError): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      req.resume();
      throw tooLarge();
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const UPLOAD_SLACK_BYTES = 16384;
const uploadLimit = (kind: Upload): number => (kind === 'roster' ? config.rosterMaxBytes : config.logoMaxBytes);

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === new URL(config.publicUrl).origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
}

export const crossSite = (): ApiError => new ApiError('forbidden', MSG.crossSite);

function parseJson(raw: Buffer): Record<string, unknown> {
  if (!raw.length) return {};
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // falls through to the validation error below
  }
  return fail('validation', MSG.checkFields, { fields: {} });
}

async function parseUpload(req: IncomingMessage, raw: Buffer, kind: Upload): Promise<UploadedFile> {
  const form = await new Request('http://upload.invalid/', {
    method: 'POST', headers: { 'content-type': String(req.headers['content-type'] ?? '') }, body: new Uint8Array(raw),
  }).formData().catch(() => null);
  const part = form?.get('file');
  if (!part || typeof part === 'string') return fail('validation', MSG.checkFields, { fields: { file: 'Choose a file.' } });
  const bytes = Buffer.from(await part.arrayBuffer());
  if (bytes.length > uploadLimit(kind)) fail('too_large', MSG.tooLargeFile(uploadLimit(kind)));
  return { name: part.name, bytes };
}

async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const path = url.pathname;
  if (method !== 'GET' && !sameOrigin(req)) throw crossSite();
  if (path.startsWith('/api/share/') && method !== 'GET') fail('read_only', MSG.readOnly);
  const found = routes.find((r) => r.method === method && r.pattern.test(path));
  if (!found) return fail('not_found', MSG.pageNotFound);
  const params: Record<string, string> = {};
  const match = found.pattern.exec(path) as RegExpExecArray;
  found.keys.forEach((key, i) => { params[key] = decodeURIComponent(match[i + 1] as string); });
  let raw: Buffer = Buffer.alloc(0);
  if (method !== 'GET') {
    raw = found.upload
      ? await readBody(req, uploadLimit(found.upload) + UPLOAD_SLACK_BYTES, () => new ApiError('too_large', MSG.tooLargeFile(uploadLimit(found.upload as Upload))))
      : await readBody(req, config.jsonLimitBytes, () => new ApiError('too_large', MSG.tooLargeBody(config.jsonLimitBytes)));
  }
  const user = await userFor(req);
  if (found.auth && !user) fail('unauthenticated', MSG.unauthenticated);
  const kind = found.upload;
  const reply = await found.handler({ req, params, query: url.searchParams, user, json: () => parseJson(raw),
    file: () => parseUpload(req, raw, kind as Upload) });
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', ...reply.headers };
  if (reply.raw) return send(res, reply.status, headers, reply.raw);
  if (reply.body === undefined) return send(res, reply.status, headers);
  send(res, reply.status, { 'Content-Type': JSON_TYPE, ...headers }, JSON.stringify(reply.body));
}

const PAGE_ROUTES = [/^\/$/, /^\/signin$/, /^\/signup$/, /^\/t$/, /^\/t\/new$/, /^\/t\/[^/]+$/,
  /^\/t\/[^/]+\/(setup|bracket|disputes|me)$/, /^\/s\/[^/]+$/, /^\/u\/[^/]+$/];

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml',
};

const publicDir = new URL('./public/', import.meta.url);

async function servePage(res: ServerResponse, path: string): Promise<void> {
  const isAsset = path.startsWith('/assets/') || path.startsWith('/fonts/');
  if (isAsset) {
    const clean = path.replace(/^\/+/, '');
    if (clean.includes('..')) return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    try {
      const bytes = await readFile(new URL(clean, publicDir));
      const cache = path.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      return send(res, 200, { 'Content-Type': CONTENT_TYPES[extname(clean)] ?? 'application/octet-stream', 'Cache-Control': cache }, bytes);
    } catch {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }
  }
  const html = await readFile(new URL('index.html', publicDir));
  send(res, PAGE_ROUTES.some((p) => p.test(path)) ? 200 : 404, { 'Content-Type': CONTENT_TYPES['.html'] as string, 'Cache-Control': 'no-cache' }, html);
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (!isReady()) return send(res, 503, { 'Content-Type': JSON_TYPE }, JSON.stringify({ status: 'starting' }));
    if (url.pathname.startsWith('/api/')) return await dispatch(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    return await servePage(res, url.pathname);
  } catch (error) {
    if (error instanceof ApiError) return sendError(res, error);
    console.error(error);
    send(res, 500, { 'Content-Type': JSON_TYPE }, JSON.stringify({ error: 'internal' }));
  }
}
