import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  body: unknown;
  rawBody: Buffer | null;
  session: SessionInfo | null;
  setCookies: string[];
}

export interface SessionInfo {
  id: string;
  memberId: string;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  needsBody: boolean;
}

export interface PathPart {
  literal: string;
  param: string | null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function jsonBody(req: IncomingMessage, limit: number): Promise<{ ok: boolean; body: unknown; error?: 'too_large' | 'invalid' }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        resolve({ ok: false, body: null, error: 'too_large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') {
        resolve({ ok: false, body: null, error: 'invalid' });
        return;
      }
      try {
        resolve({ ok: true, body: JSON.parse(raw) });
      } catch {
        resolve({ ok: false, body: null, error: 'invalid' });
      }
    });
    req.on('error', () => {
      if (!done) {
        done = true;
        resolve({ ok: false, body: null, error: 'invalid' });
      }
    });
  });
}

export function readRawBody(req: IncomingMessage, limit: number): Promise<{ ok: boolean; body: Buffer | null; error?: 'too_large' }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return; // discard the rest, answer 413 once the body drains
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) {
        resolve({ ok: false, body: null, error: 'too_large' });
        return;
      }
      resolve({ ok: true, body: Buffer.concat(chunks) });
    });
    req.on('error', () => {
      resolve({ ok: false, body: null, error: over ? 'too_large' : undefined });
    });
  });
}

export interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  body: Buffer;
}

export function parseMultipart(buf: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const delim = Buffer.from(`--${boundary}`);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const next = buf.indexOf(delim, pos + delim.length);
    if (next === -1) break;
    // skip boundary line's CRLF
    let start = pos + delim.length;
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    let end = next;
    if (end >= 2 && buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2;
    const part = buf.slice(start, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      let name = '';
      let filename: string | null = null;
      let contentType: string | null = null;
      for (const line of headerText.split('\r\n')) {
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        const lower = key.toLowerCase();
        if (lower === 'content-disposition') {
          const nameMatch = /name="([^"]*)"/.exec(value);
          const fileMatch = /filename="([^"]*)"/.exec(value);
          if (nameMatch) name = nameMatch[1];
          if (fileMatch) filename = fileMatch[1];
        } else if (lower === 'content-type') {
          contentType = value.split(';')[0].trim();
        }
      }
      parts.push({ name, filename, contentType, body });
    }
    pos = next;
  }
  return parts;
}
