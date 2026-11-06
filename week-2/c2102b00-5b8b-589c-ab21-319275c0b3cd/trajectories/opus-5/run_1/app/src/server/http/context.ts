import type { IncomingHttpHeaders } from 'node:http';
import type { Role } from '../../shared/types.ts';
import type { Viewer } from '../store.ts';
import type { SessionInfo } from './session.ts';
import { ApiError, forbidden, unauthenticated, validation } from './errors.ts';

export interface ApiResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  rawBody?: Buffer;
  cookies?: string[];
}

export interface RequestContext {
  method: string;
  url: URL;
  params: Record<string, string>;
  rawBody: Buffer;
  headers: IncomingHttpHeaders;
  session: SessionInfo | null;
  now: number;
}

export function requireSession(ctx: RequestContext): SessionInfo {
  if (!ctx.session) throw unauthenticated();
  return ctx.session;
}

export function viewerOf(ctx: RequestContext): Viewer {
  return requireSession(ctx).viewer;
}

export function requireRole(ctx: RequestContext, roles: Role[]): Viewer {
  const viewer = viewerOf(ctx);
  if (!roles.includes(viewer.role)) throw forbidden();
  return viewer;
}

export function jsonBody(ctx: RequestContext): Record<string, unknown> {
  if (ctx.rawBody.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.rawBody.toString('utf8'));
  } catch {
    throw validation({ body: 'Send a JSON object.' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw validation({ body: 'Send a JSON object.' });
  }
  return parsed as Record<string, unknown>;
}

export function param(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (value === undefined) throw new ApiError(404, 'not_found', 'There is nothing here.');
  return value;
}
