import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, errors } from './errors.js';
import { config } from './config.js';

export type BodyKind = 'none' | 'json' | 'bytes' | 'multipart';

export interface MultipartFile {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  bytes: Buffer;
  multipart: MultipartBody;
  header(name: string): string | undefined;
  cookies: Record<string, string>;
}

export interface Route {
  method: string;
  pattern: string;
  body: BodyKind;
  bodyLimit?: number;
  handler: (ctx: Ctx) => Promise<unknown> | unknown;
}

export const noContent = Symbol('no-content');

export class Sent {
  constructor(readonly done: true = true) {}
}

export const sent = new Sent();

export function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw errors.tooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw errors.tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function parseJsonBody(raw: Buffer): unknown {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw errors.field('body', 'not valid JSON');
  }
}

function headerValue(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`${name}:\\s*(.*)`, 'i'));
  return match ? match[1].trim() : undefined;
}

export function parseMultipart(raw: Buffer, contentType: string): MultipartBody {
  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
  if (!boundaryMatch) throw errors.field('file', 'not a multipart request');
  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  const fields: Record<string, string> = {};
  const files: Record<string, MultipartFile> = {};
  let index = raw.indexOf(boundary);
  while (index !== -1) {
    const partStart = index + boundary.length;
    if (raw.slice(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = raw.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;
    const headerBlock = raw.slice(partStart, headerEnd).toString('utf8');
    const next = raw.indexOf(boundary, headerEnd);
    const bodyEnd = next === -1 ? raw.length : next - 2;
    const value = raw.slice(headerEnd + 4, bodyEnd);
    const disposition = headerValue(headerBlock, 'content-disposition') ?? '';
    const nameMatch = disposition.match(/name="([^"]*)"/);
    const fileMatch = disposition.match(/filename="([^"]*)"/);
    if (nameMatch) {
      if (fileMatch) {
        files[nameMatch[1]] = {
          fileName: fileMatch[1],
          contentType: headerValue(headerBlock, 'content-type') ?? 'application/octet-stream',
          bytes: value,
        };
      } else {
        fields[nameMatch[1]] = value.toString('utf8');
      }
    }
    index = next;
  }
  return { fields, files };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body);
}

export function isStateChanging(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export function checkOrigin(ctx: Ctx): void {
  if (!isStateChanging(ctx.method)) return;
  const origin = ctx.header('origin');
  if (origin === undefined || origin === 'null') return;
  const host = ctx.header('host');
  const allowed = new Set([config.publicOrigin]);
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  if (!allowed.has(origin.replace(/\/+$/, ''))) throw errors.crossOrigin();
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}
