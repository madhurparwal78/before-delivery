import { ApiError, errors } from './errors.js';

export interface Ctx {
  req: Request;
  url: URL;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  rawBody: () => Promise<Buffer>;
  setCookie: (value: string) => void;
  responseHeaders: Record<string, string>;
  session: SessionInfo | null;
  partnerKey: PartnerKeyInfo | null;
}

export interface SessionInfo { memberId: string; workspaceSlug: string; role: string; name: string; email: string }
export interface PartnerKeyInfo { id: string; workspaceSlug: string }

export interface Route {
  method: string;
  pattern: string;
  roles?: readonly string[] | 'public' | 'session' | 'partner';
  handler: string;
  bodyLimit: number;
  bodyKind: 'json' | 'raw' | 'multipart' | 'none';
}

export function matchRoute(routes: Route[], method: string, path: string): { route: Route | null; params: Record<string, string>; allowHeader: string | null } {
  const segmentRoutes = routes.filter((r) => r.pattern.includes(':'));
  const allowSet = new Set<string>();
  let params: Record<string, string> = {};
  for (const route of routes) {
    const result = matchPattern(route.pattern, path);
    if (result !== null) {
      if (route.method === method) {
        return { route, params: result, allowHeader: null };
      }
      allowSet.add(route.method);
    }
  }
  void segmentRoutes;
  if (allowSet.size > 0) {
    return { route: null, params, allowHeader: [...allowSet].sort().join(', ') };
  }
  return { route: null, params, allowHeader: null };
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (pp !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === null) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name.length > 0) out[name] = value;
  }
  return out;
}

export function readBody(req: Request, limit: number): Promise<{ ok: true; body: Buffer } | { ok: false; tooLarge: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const reader = req.body?.getReader();
    if (reader === undefined) {
      resolve({ ok: true, body: Buffer.alloc(0) });
      return;
    }
    const pump = (): void => {
      reader.read().then((r) => {
        if (done) return;
        if (r.done) {
          done = true;
          resolve({ ok: true, body: Buffer.concat(chunks) });
          return;
        }
        total += r.value.byteLength;
        if (total > limit) {
          done = true;
          void reader.cancel();
          resolve({ ok: false, tooLarge: true });
          return;
        }
        chunks.push(Buffer.from(r.value));
        pump();
      }).catch(() => {
        if (!done) {
          done = true;
          resolve({ ok: true, body: Buffer.concat(chunks) });
        }
      });
    };
    pump();
  });
}

export function jsonOk(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return new Response(err.body(), { status: err.status, headers: { 'Content-Type': 'application/json', ...err.extraHeaders } });
  }
  console.error('internal error:', err);
  return new Response(JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong.', fields: {} } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}

export function requireJsonContentType(ctx: Ctx, kinds: readonly string[]): void {
  const ct = ctx.req.headers.get('content-type') ?? '';
  const mime = ct.split(';')[0].trim().toLowerCase();
  if (!kinds.includes(mime)) {
    throw errors.unsupportedMedia();
  }
}

export function parseJsonBody(body: Buffer): Record<string, unknown> {
  if (body.length === 0) throw errors.badJson();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw errors.badJson();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw errors.badJson();
  return parsed as Record<string, unknown>;
}
