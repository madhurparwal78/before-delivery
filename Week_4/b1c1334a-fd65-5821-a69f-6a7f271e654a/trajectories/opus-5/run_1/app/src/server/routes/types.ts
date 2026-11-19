import type { Client } from '../db.js';
import type { RequestContext } from '../http.js';
import type { Account } from '../session.js';

export type Reply = {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
};

export type RouteContext = {
  request: RequestContext;
  client: Client;
  account: Account;
  params: Record<string, string>;
};

export type PublicRouteContext = Omit<RouteContext, 'account'> & { account: Account | null };
