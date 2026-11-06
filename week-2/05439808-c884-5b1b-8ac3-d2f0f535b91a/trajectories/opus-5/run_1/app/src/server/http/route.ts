import type { Queryable } from '../db.js';
import type { AccountRecord } from '../domain/accounts.js';
import type { SessionRecord } from '../domain/sessions.js';

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  setSessionCookie?: string;
};

export type BaseCtx = {
  method: Method;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  rawBody: string;
  now: Date;
  idempotencyKey: string | null;
};

export type PublicCtx = BaseCtx & {
  session: SessionRecord | null;
  account: AccountRecord | null;
};

export type AuthedCtx = BaseCtx & {
  session: SessionRecord;
  account: AccountRecord;
};

export type Route =
  | {
      method: Method;
      pattern: string;
      auth: 'public';
      requiresKey?: false;
      handler: (ctx: PublicCtx, client: Queryable) => Promise<Reply>;
    }
  | {
      method: Method;
      pattern: string;
      auth: 'session' | 'verified' | 'operator';
      requiresKey?: boolean;
      handler: (ctx: AuthedCtx, client: Queryable) => Promise<Reply>;
    };

export function publicRoute(
  method: Method,
  pattern: string,
  handler: (ctx: PublicCtx, client: Queryable) => Promise<Reply>
): Route {
  return { method, pattern, auth: 'public', handler };
}

export function sessionRoute(
  method: Method,
  pattern: string,
  handler: (ctx: AuthedCtx, client: Queryable) => Promise<Reply>
): Route {
  return { method, pattern, auth: 'session', handler };
}

export function verifiedRoute(
  method: Method,
  pattern: string,
  handler: (ctx: AuthedCtx, client: Queryable) => Promise<Reply>,
  requiresKey = false
): Route {
  return { method, pattern, auth: 'verified', requiresKey, handler };
}

export function operatorRoute(
  method: Method,
  pattern: string,
  handler: (ctx: AuthedCtx, client: Queryable) => Promise<Reply>
): Route {
  return { method, pattern, auth: 'operator', handler };
}

export function keyedSessionRoute(
  method: Method,
  pattern: string,
  handler: (ctx: AuthedCtx, client: Queryable) => Promise<Reply>
): Route {
  return { method, pattern, auth: 'session', requiresKey: true, handler };
}
