import type { Config } from '../config';
import type { Database } from '../db/pool';
import type { BusinessClock } from '../domain/clock';
import type { KillBill } from '../services/killbill';
import type { Mailer } from '../services/mailer';
import type { TicketStorage } from '../services/storage';

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly killbill_account_id: string | null;
}

export interface AppServices {
  readonly config: Config;
  /** Flipped once the database is connected and the schema and seed data are applied. */
  readonly ready: { value: boolean };
  readonly database: Database;
  readonly clock: BusinessClock;
  readonly killbill: KillBill;
  readonly storage: TicketStorage;
  readonly mailer: Mailer;
}

/** Everything one request carries. Request identity never lives in module-level state. */
export interface RequestContext {
  readonly app: AppServices;
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly bodyHash: string;
  readonly idempotencyKey: string | null;
  readonly sessionId: string | null;
  readonly account: Account | null;
  /** The business clock at the instant the request arrived. */
  readonly now: number;
  readonly setCookie: (value: string) => void;
}

export function requireAccount(context: RequestContext): Account {
  if (context.account === null) throw new Error('route is marked auth: required');
  return context.account;
}

export interface ApiResponse {
  readonly status: number;
  readonly json?: unknown;
  readonly body?: Buffer;
  readonly headers?: Readonly<Record<string, string>>;
}

export type RouteHandler = (context: RequestContext) => Promise<ApiResponse>;

export interface Route {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly auth: 'required' | 'optional';
  readonly needsIdempotencyKey?: boolean;
  readonly handler: RouteHandler;
}

export function matchRoute(
  routes: readonly Route[],
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/').filter((part) => part.length > 0);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split('/').filter((part) => part.length > 0);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, segment] of pattern.entries()) {
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[index]);
      else if (segment !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}
