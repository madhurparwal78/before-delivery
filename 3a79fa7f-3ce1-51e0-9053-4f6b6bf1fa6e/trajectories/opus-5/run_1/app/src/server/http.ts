import type { IncomingMessage, ServerResponse } from 'node:http';
import { now } from './clock.js';
import { ApiError, fail } from './errors.js';

export const MAX_BODY_BYTES = 65536;

export type Role = 'customer' | 'admin' | 'dealer' | 'support';

export interface Session {
  sessionId: string;
  userId: number;
  email: string;
  role: Role;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  rawBody: string;
  cookies: Record<string, string>;
  session: Session | null;
  setCookie(name: string, value: string, maxAgeSeconds?: number): void;
  clearCookie(name: string): void;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;

export type Access = 'anyone' | 'signed-in' | 'customer' | Role[];

interface RouteEntry {
  access: Access;
  handler: Handler;
}

interface RouteNode {
  segments: string[];
  methods: Map<string, RouteEntry>;
}

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export class Router {
  private readonly nodes: RouteNode[] = [];

  add(method: string, path: string, access: Access, handler: Handler): void {
    const segments = path.split('/').filter((s) => s.length > 0);
    let node = this.nodes.find((n) => n.segments.length === segments.length && n.segments.every((s, i) => s === segments[i]));
    if (!node) {
      node = { segments, methods: new Map() };
      this.nodes.push(node);
    }
    node.methods.set(method, { access, handler });
  }

  match(method: string, pathSegments: string[]): { entry: RouteEntry; params: Record<string, string> } {
    const candidates = this.nodes.filter((n) => n.segments.length === pathSegments.length);
    let matchedNode: RouteNode | null = null;
    let matchedParams: Record<string, string> = {};
    for (const node of candidates) {
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < node.segments.length; i += 1) {
        const pattern = node.segments[i] as string;
        const actual = pathSegments[i] as string;
        if (pattern.startsWith(':')) params[pattern.slice(1)] = actual;
        else if (pattern !== actual) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const isStatic = node.segments.every((s) => !s.startsWith(':'));
      if (isStatic) return this.pick(node, params, method);
      if (!matchedNode) {
        matchedNode = node;
        matchedParams = params;
      }
    }
    if (!matchedNode) fail('not_found');
    return this.pick(matchedNode, matchedParams, method);
  }

  private pick(node: RouteNode, params: Record<string, string>, method: string): { entry: RouteEntry; params: Record<string, string> } {
    const wanted = method === 'HEAD' ? 'GET' : method;
    const entry = node.methods.get(wanted);
    if (!entry) {
      const allow = METHOD_ORDER.filter((m) => node.methods.has(m)).join(', ');
      fail('method_not_allowed', { headers: { Allow: allow } });
    }
    return { entry, params };
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        overflowed = true;
        chunks.length = 0;
        reject(new ApiError('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (!overflowed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

export function parseJsonBody(raw: string, contentType: string | undefined): Record<string, unknown> {
  if (raw.length === 0) return {};
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (mime !== 'application/json') fail('unsupported_media_type');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('bad_request');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('bad_request');
  return parsed as Record<string, unknown>;
}

export interface JsonReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export function reply(status: number, body: unknown, headers?: Record<string, string>): JsonReply {
  return { status, body, headers };
}

export function isJsonReply(value: unknown): value is JsonReply {
  return typeof value === 'object' && value !== null && 'status' in value && 'body' in value;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    Date: now().toUTCString(),
    ...headers,
  });
  res.end(res.req.method === 'HEAD' ? undefined : payload);
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body(), error.headers ?? {});
}
