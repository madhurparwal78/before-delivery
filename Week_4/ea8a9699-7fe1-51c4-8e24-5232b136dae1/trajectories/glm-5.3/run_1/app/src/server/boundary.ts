// The server boundary: same-origin writes, size limits, content types, and the
// never-served list. These refusals precede every other check.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { crossOrigin, tooLarge, unsupportedMediaType } from './errors.js';
import { ApiError } from './errors.js';

export const JSON_BODY_LIMIT = 65_536;
export const IMAGE_LIMIT = 15_000_000;
export const CLIP_LIMIT = 60_000_000;
export const STILL_LIMIT = 8_000_000;

export function isWriteMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

export function ownOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? '';
  return `http://${host}`;
}

export function checkSameOrigin(req: IncomingMessage): void {
  if (!isWriteMethod(req.method ?? 'GET')) return;
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host ?? '';
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    throw crossOrigin();
  }
  if (originHost !== host) throw crossOrigin();
}

const NEVER_SERVED = ['package.json', 'package-lock.json', 'run.json', 'tsconfig.json', '.env', '.git'];

/** Paths that must answer 404 before any other request check. */
export function isNeverServed(pathname: string): boolean {
  if (pathname.includes('..')) return true;
  const base = pathname.split('/').filter(Boolean).at(-1) ?? '';
  if (NEVER_SERVED.some((n) => base === n || base.startsWith(`${n}.`))) return true;
  if (/^\/(src|dist\/server|node_modules|scripts|assets\/capstan)\b/.test(pathname)) return true;
  if (pathname.endsWith('.ts') && !pathname.startsWith('/assets/')) return true;
  // Server bundles never serve.
  if (/^\/dist\//.test(pathname)) return true;
  return false;
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > limit) {
        done = true;
        reject(tooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (!done) reject(new ApiError(400, 'not_found' as never, 'Bad request.'));
    });
  });
}

export interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  body: Buffer;
}

/** Parse multipart/form-data, returning parts and their exact byte boundaries. */
export function parseMultipart(body: Buffer, contentTypeHeader: string): MultipartPart[] {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  if (!m) throw unsupportedMediaType();
  const boundary = `--${(m[1] ?? m[2] ?? '').trim()}`;
  const parts: MultipartPart[] = [];
  const boundaryBuf = Buffer.from(boundary);
  let start = body.indexOf(boundaryBuf);
  while (start !== -1) {
    const next = body.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    const segment = body.subarray(start + boundaryBuf.length, next);
    const sep = segment.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const headerText = segment.subarray(0, sep).toString('utf8');
      const content = segment.subarray(sep + 4, segment.length - 2); // drop trailing CRLF
      const nameMatch = /name="([^"]*)"/i.exec(headerText);
      const fileMatch = /filename="([^"]*)"/i.exec(headerText);
      const ctMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerText);
      parts.push({
        name: nameMatch?.[1] ?? '',
        filename: fileMatch?.[1] ?? null,
        contentType: ctMatch?.[1]?.trim() ?? null,
        body: Buffer.from(content),
      });
    }
    start = next;
  }
  return parts;
}
