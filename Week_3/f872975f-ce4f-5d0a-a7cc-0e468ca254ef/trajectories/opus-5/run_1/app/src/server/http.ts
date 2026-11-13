import { IncomingHttpHeaders } from 'node:http';
import { ApiError } from './errors';
import { Role, SessionUser } from './session';

export interface RequestContext {
  method: string;
  url: URL;
  path: string;
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
  body: Buffer;
  json: Record<string, unknown>;
  jsonRaw: unknown;
  user: SessionUser | null;
  now: Date;
}

export interface Reply {
  status: number;
  json?: unknown;
  rawJson?: string;
  body?: Buffer;
  headers?: Record<string, string>;
  cookies?: string[];
}

export const jsonReply = (status: number, json: unknown): Reply => ({ status, json });

export function requireUser(context: RequestContext): SessionUser {
  if (context.user === null) throw new ApiError('unauthenticated');
  return context.user;
}

export function requireRole(context: RequestContext, roles: Role[]): SessionUser {
  const user = requireUser(context);
  if (!roles.includes(user.role)) throw new ApiError('forbidden');
  return user;
}

export const STAFF: Role[] = ['owner', 'hand'];

export function headerOf(context: RequestContext, name: string): string | undefined {
  const value = context.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function pathParam(context: RequestContext, name: string): string {
  return context.params[name] ?? '';
}
