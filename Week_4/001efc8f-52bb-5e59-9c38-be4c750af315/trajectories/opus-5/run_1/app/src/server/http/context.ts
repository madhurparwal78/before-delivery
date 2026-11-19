import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from '../errors';
import { LIMITS } from '../config';
import { nowDate } from '../clock';
import type { Role } from '../../shared/api';
import type { UserRow, Viewer } from '../domain/users';

export interface SessionUser extends UserRow {
  token: string;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  url: URL;
  params: Record<string, string>;
  isMultipart: boolean;
  user: SessionUser | null;
}

export function viewerOf(user: SessionUser): Viewer {
  return { id: user.id, workspaceId: user.workspace_id, role: user.role as Role };
}

export function requireUser(ctx: RequestContext): SessionUser {
  if (ctx.user === null) throw new ApiError('unauthenticated');
  return ctx.user;
}

export function sendJson(ctx: RequestContext, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  ctx.res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    date: nowDate().toUTCString(),
    ...headers,
  });
  ctx.res.end(text);
}

export function sendNoContent(ctx: RequestContext): void {
  ctx.res.writeHead(204, { date: nowDate().toUTCString() });
  ctx.res.end();
}

export async function readRawBody(ctx: RequestContext, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise<Buffer>((resolve, reject) => {
    ctx.req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new ApiError('payload_too_large'));
        ctx.req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => resolve(Buffer.concat(chunks)));
    ctx.req.on('error', (error) => reject(error));
  });
}

export async function readJsonBody(ctx: RequestContext): Promise<Record<string, unknown>> {
  const raw = await readRawBody(ctx, LIMITS.jsonBodyBytes);
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError('validation', { errors: {} });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('validation', { errors: {} });
  }
  return parsed as Record<string, unknown>;
}

export function queryParam(ctx: RequestContext, name: string): string | null {
  return ctx.url.searchParams.get(name);
}
