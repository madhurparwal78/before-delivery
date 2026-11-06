import type { IncomingMessage, ServerResponse } from 'node:http';
import { isApiFail, serviceUnavailable } from './errors.js';

export interface Req {
  method: string;
  url: string;
  headers: Record<string, string>;
  rawBody: Buffer | null;
  query: URLSearchParams;
  rawPath: string;
  path: string;
  params: Record<string, string>;
}

export type Handler = (req: Req, res: ServerResponse) => Promise<void> | void;
interface Route { method: string; segments: string[]; handler: Handler; wildcard: boolean }

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    const segments = pattern.split('/').filter(s => s.length > 0);
    const wildcard = segments.includes('**');
    this.routes.push({ method, segments, handler, wildcard });
  }

  get(pattern: string, h: Handler): void { this.add('GET', pattern, h); }
  post(pattern: string, h: Handler): void { this.add('POST', pattern, h); }
  put(pattern: string, h: Handler): void { this.add('PUT', pattern, h); }
  patch(pattern: string, h: Handler): void { this.add('PATCH', pattern, h); }
  delete(pattern: string, h: Handler): void { this.add('DELETE', pattern, h); }
  head(pattern: string, h: Handler): void { this.add('HEAD', pattern, h); }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = path.split('/').filter(s => s.length > 0);
    // Exact-length routes win over wildcard routes.
    let wildcardMatch: { handler: Handler; params: Record<string, string> } | null = null;
    for (const r of this.routes) {
      if (r.method !== method && !(r.method === 'GET' && method === 'HEAD')) continue;
      if (r.wildcard) {
        if (wildcardMatch) continue;
        const n = r.segments.length - 1;
        if (parts.length < n) continue;
        let ok = true;
        const params: Record<string, string> = {};
        for (let i = 0; i < n; i++) {
          const seg = r.segments[i];
          if (seg.startsWith('{')) params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
          else if (seg !== parts[i]) { ok = false; break; }
        }
        if (!ok) continue;
        params['**'] = parts.slice(n).map(decodeURIComponent).join('/');
        wildcardMatch = { handler: r.handler, params };
        continue;
      }
      if (r.segments.length !== parts.length) continue;
      let ok = true;
      const params: Record<string, string> = {};
      for (let i = 0; i < parts.length; i++) {
        const seg = r.segments[i];
        if (seg.startsWith('{')) params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      return { handler: r.handler, params };
    }
    return wildcardMatch;
  }
}

export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json), ...extraHeaders });
  res.end(json);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, { 'Content-Length': 0 });
  res.end();
}

/** Maps any thrown value to the documented 503 when Postgres is unreachable. */
export function mapDbError(e: unknown): void {
  if (isApiFail(e)) throw e;
  if (e instanceof Error && /ECONNREFUSED|ETIMEDOUT|connection terminated|does not exist|terminated unexpectedly/i.test(e.message)) {
    throw serviceUnavailable();
  }
  throw e;
}