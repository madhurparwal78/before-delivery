import type { IncomingMessage, ServerResponse } from 'node:http';
import { MSG } from '../shared/messages.js';
import { HttpError } from './errors.js';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  cookies: Record<string, string>;
  rawBody: Buffer | null;
  parsed: Record<string, unknown> | null;
}

export function cookiesOf(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', MSG.serverError));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (error) => reject(error));
  });
}

export function parseJson(buffer: Buffer): Record<string, unknown> {
  if (buffer.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(buffer.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new HttpError(400, 'BAD_JSON', MSG.serverError);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'BAD_JSON', MSG.serverError);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

export function sendNoContent(res: ServerResponse, headers: Record<string, string> = {}): void {
  res.writeHead(204, headers);
  res.end();
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(html);
}

export function sendBytes(
  res: ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  cache = 'no-store',
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

export function sessionCookie(token: string): string {
  return `oc_session=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedCookie(): string {
  return 'oc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

export interface MultipartFile {
  name: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export function parseMultipart(buffer: Buffer, contentType: string): MultipartFile[] {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', MSG.serverError);
  const boundary = `--${match[1] ?? match[2]}`;
  const files: MultipartFile[] = [];
  let index = buffer.indexOf(boundary);
  while (index !== -1) {
    const start = index + boundary.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(start, headerEnd).toString('utf8');
    const next = buffer.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const bytes = buffer.slice(headerEnd + 4, next - 2);
    const nameMatch = headerText.match(/name="([^"]*)"/);
    const filenameMatch = headerText.match(/filename="([^"]*)"/);
    const typeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
    files.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : '',
      contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
      bytes,
    });
    index = next;
  }
  return files;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
