import type { RequestContext } from './types.js';
import { ApiError } from '../errors.js';

export type Role = 'author' | 'editor' | 'contributor' | 'staff';

export function sendJson(ctx: RequestContext, status: number, body: unknown): void {
  const text = body === null ? '' : JSON.stringify(body);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', 'application/json');
  ctx.res.end(text);
}

export function sendRaw(
  ctx: RequestContext,
  status: number,
  body: Buffer | string,
  contentType: string,
  extraHeaders?: Record<string, string>,
): void {
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', contentType);
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    ctx.res.setHeader(name, value);
  }
  ctx.res.end(body);
}

