import { IncomingMessage, ServerResponse } from 'node:http';
import { Caller } from '../actions/returns';
import { UserRow } from '../auth';
import { asRecord } from '../domain/validate';
import * as errors from './errors';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  user: UserRow | null;
  token: string | null;
  body: unknown;
}

export function bodyRecord(ctx: Ctx): Record<string, unknown> {
  return asRecord(ctx.body);
}

export function callerOf(user: UserRow): Caller {
  return {
    userId: user.id,
    practiceId: user.practice_id,
    role: user.role,
    clientId: user.client_id,
    displayName: user.display_name,
  };
}

/** A route that needs a session but names no record. */
export function requireSession(ctx: Ctx): UserRow {
  if (!ctx.user) throw errors.signInRequired();
  return ctx.user;
}

export function requireBookkeeper(ctx: Ctx): UserRow {
  const user = requireSession(ctx);
  if (user.role !== 'bookkeeper') throw errors.forbidden();
  return user;
}

/** A route that names a record: a signed-out caller can open no record. */
export function callerForRecord(ctx: Ctx): Caller {
  if (!ctx.user) throw errors.notFound();
  return callerOf(ctx.user);
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

export function sendEmpty(
  res: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end();
}
