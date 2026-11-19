import type { IncomingMessage, ServerResponse } from 'node:http';

export type ParsedUrl = {
  path: string;
  query: URLSearchParams;
};

export function parseUrl(req: IncomingMessage): ParsedUrl {
  const raw = req.url ?? '/';
  const idx = raw.indexOf('?');
  const path = decodeURIComponent(idx === -1 ? raw : raw.slice(0, idx));
  const query = new URLSearchParams(idx === -1 ? '' : raw.slice(idx + 1));
  return { path, query };
}

export function clientAddress(req: IncomingMessage, trustForwardedFor: boolean): string {
  if (trustForwardedFor) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
      const first = fwd.split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

export function sendBytes(
  res: ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

export function sendHtml(
  res: ServerResponse,
  status: number,
  html: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(html);
}

export function redirect(res: ServerResponse, location: string, status = 303): void {
  res.writeHead(status, {
    Location: location,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end();
}

export async function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; body: Buffer } | { ok: false; tooLarge: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        if (tooLarge) {
          resolve({ ok: false, tooLarge: true });
          return;
        }
        resolve({ ok: true, body: Buffer.concat(chunks) });
      }
    });
    req.on('error', () => {
      if (!done) {
        done = true;
        resolve({ ok: false, tooLarge: tooLarge });
      }
    });
    req.on('aborted', () => {
      if (!done) {
        done = true;
        resolve({ ok: false, tooLarge: false });
      }
    });
  });
}

export function parseJsonBody(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function serializeCookie(name: string, value: string, attrs: Record<string, string>): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  for (const [k, v] of Object.entries(attrs)) parts.push(`${k}=${v}`);
  return parts.join('; ');
}

export function etagFor(version: number): string {
  return `"${version}"`;
}

export function ifMatchVersion(req: IncomingMessage): number | null {
  const header = req.headers['if-match'];
  if (typeof header !== 'string' || header === '') return null;
  const m = /^"(\d+)"$/.exec(header.trim());
  return m ? Number(m[1]) : null;
}
