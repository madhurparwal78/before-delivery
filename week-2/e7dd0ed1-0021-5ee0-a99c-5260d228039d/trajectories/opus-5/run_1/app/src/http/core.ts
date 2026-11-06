import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, RateLimited, S3Error, apiError } from '../errors';

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  rawPath: string;
  rawQuery: string;
  query: URLSearchParams;
  params: Record<string, string>;
  cookies: Record<string, string>;
  bodyBuffer?: Buffer;
}

export function nowSecond(at: Date = new Date()): Date {
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

export function buildContext(req: IncomingMessage, res: ServerResponse): Context {
  const target = req.url ?? '/';
  const questionMark = target.indexOf('?');
  const rawPath = questionMark < 0 ? target : target.slice(0, questionMark);
  const rawQuery = questionMark < 0 ? '' : target.slice(questionMark + 1);
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = rawPath;
  }
  return {
    req,
    res,
    method: (req.method ?? 'GET').toUpperCase(),
    path,
    rawPath,
    rawQuery,
    query: new URLSearchParams(rawQuery),
    params: {},
    cookies: parseCookies(req.headers.cookie),
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function header(ctx: Context, name: string): string | undefined {
  const value = ctx.req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(',') : value;
}

export class PayloadTooLarge extends Error {}

export async function readBody(ctx: Context, limit: number): Promise<Buffer> {
  if (ctx.bodyBuffer) return ctx.bodyBuffer;
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of ctx.req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      ctx.req.destroy();
      throw new PayloadTooLarge();
    }
    parts.push(buffer);
  }
  ctx.bodyBuffer = Buffer.concat(parts);
  return ctx.bodyBuffer;
}

export function setHeaders(ctx: Context, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) ctx.res.setHeader(name, value);
}

export function sendJson(ctx: Context, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  setHeaders(ctx, headers);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
  ctx.res.setHeader('Content-Length', Buffer.byteLength(text));
  ctx.res.end(ctx.method === 'HEAD' ? undefined : text);
}

export function sendNoContent(ctx: Context, headers: Record<string, string> = {}): void {
  setHeaders(ctx, headers);
  ctx.res.statusCode = 204;
  ctx.res.end();
}

export function sendText(ctx: Context, status: number, body: string, contentType: string, headers: Record<string, string> = {}): void {
  setHeaders(ctx, headers);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', contentType);
  ctx.res.setHeader('Content-Length', Buffer.byteLength(body));
  ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
}

export function sendApiError(ctx: Context, error: ApiError): void {
  const headers: Record<string, string> = {};
  if (error instanceof RateLimited) headers['Retry-After'] = String(error.retryAfterSeconds);
  if (error.code === 'unauthenticated') headers['Set-Cookie'] = 'fs_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
  sendJson(ctx, error.status, error.body(), headers);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function xml(value: string): string {
  return escapeXml(value);
}

export function sendS3Error(ctx: Context, error: S3Error, requestId: string): void {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${escapeXml(error.code)}</Code><Message>${escapeXml(
    error.message,
  )}</Message><Resource>${escapeXml(ctx.path)}</Resource><RequestId>${escapeXml(requestId)}</RequestId></Error>`;
  setHeaders(ctx, error.headers);
  ctx.res.statusCode = error.status;
  ctx.res.setHeader('Content-Type', 'application/xml');
  ctx.res.setHeader('Content-Length', Buffer.byteLength(body));
  ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
}

export function requireXRequestedWith(ctx: Context): void {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method) && header(ctx, 'x-requested-with') !== 'farshore') {
    throw apiError('forbidden', 'Send this request from the Farshore console.');
  }
}

export async function readJsonBody(ctx: Context, limit: number): Promise<Record<string, unknown>> {
  let raw: Buffer;
  try {
    raw = await readBody(ctx, limit);
  } catch (error) {
    if (error instanceof PayloadTooLarge) throw apiError('payload_too_large', 'That request is too large.');
    throw error;
  }
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw apiError('validation_failed', 'Send a JSON object.', { errors: { body: 'Send a JSON object.' } });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw apiError('validation_failed', 'Send a JSON object.', { errors: { body: 'Send a JSON object.' } });
  }
  return parsed as Record<string, unknown>;
}

/** Published fields only: any other top-level member is named back as unsettable. */
export function onlyFields(body: Record<string, unknown>, allowed: string[]): Record<string, string> {
  const failures: Record<string, string> = {};
  for (const name of Object.keys(body)) {
    if (!allowed.includes(name)) failures[name] = "This field can't be set.";
  }
  return failures;
}
