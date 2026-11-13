/**
 * The route table and the dispatcher that applies the published error
 * precedence: body limit, origin, media type, JSON, session, retry key,
 * stored replay, unknown resource, role and ownership, and only then the
 * endpoint's own checks.
 *
 * Routes are grouped by what they resolve from the path, so a handler is
 * handed exactly the session, asset or position it is defined for.
 */

import type { IncomingHttpHeaders } from 'node:http';
import { isAsset, type Asset } from '../domain/assets.ts';
import { query } from '../db/pool.ts';
import { checkReplay, readIdempotencyKey } from './idempotency.ts';
import { forbidden, notFound, unauthenticated } from './problem.ts';
import { bearerToken, memberForToken, type Member, type Role } from './sessions.ts';

export interface Reply {
  readonly status: number;
  readonly body?: unknown;
  /** A JSON body already serialised, returned byte for byte. */
  readonly bodyText?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly raw?: { readonly contentType: string; readonly bytes: Uint8Array };
}

/** Everything a handler knows about the request itself. */
export interface Request {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly search: URLSearchParams;
  readonly body: Readonly<Record<string, unknown>>;
  readonly headers: IncomingHttpHeaders;
  readonly nowMs: number;
  /** The retry key on keyed routes, and an empty string elsewhere. */
  readonly idempotencyKey: string;
}

export interface ResolvedPosition {
  readonly positionId: string;
  readonly borrowerId: string;
}

interface Common {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly pattern: string;
  readonly keyed?: true;
  /** The roles allowed to call it; every member may call it when absent. */
  readonly roles?: readonly Role[];
}

/** The health check, the member list and session creation carry no token. */
export interface AnonymousRoute extends Common {
  readonly kind: 'anonymous';
  readonly handler: (request: Request) => Promise<Reply>;
}

export interface MemberRoute extends Common {
  readonly kind: 'member';
  readonly handler: (request: Request, member: Member) => Promise<Reply>;
}

export interface AssetRoute extends Common {
  readonly kind: 'asset';
  readonly handler: (request: Request, member: Member, asset: Asset) => Promise<Reply>;
}

export interface PositionRoute extends Common {
  readonly kind: 'position';
  /** A borrower may act only on positions they own. */
  readonly ownedPosition?: true;
  readonly handler: (
    request: Request,
    member: Member,
    position: ResolvedPosition,
  ) => Promise<Reply>;
}

export interface SettlementRoute extends Common {
  readonly kind: 'settlement';
  readonly handler: (request: Request, member: Member, settlementId: string) => Promise<Reply>;
}

export type Route = AnonymousRoute | MemberRoute | AssetRoute | PositionRoute | SettlementRoute;

interface Compiled {
  readonly route: Route;
  readonly segments: readonly string[];
}

export class Router {
  private readonly compiled: readonly Compiled[];

  constructor(routes: readonly Route[]) {
    this.compiled = routes.map((route) => ({
      route,
      segments: route.pattern.split('/').filter((segment) => segment !== ''),
    }));
  }

  private match(
    method: string,
    path: string,
  ): { route: Route; params: Record<string, string> } | null {
    const parts = path.split('/').filter((segment) => segment !== '');
    for (const { route, segments } of this.compiled) {
      if (route.method !== method) continue;
      if (segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < segments.length; index += 1) {
        const expected = segments[index];
        const actual = parts[index];
        if (expected === undefined || actual === undefined) {
          matched = false;
          break;
        }
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeURIComponent(actual);
          continue;
        }
        if (expected !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  async dispatch(input: {
    method: string;
    path: string;
    search: URLSearchParams;
    body: Readonly<Record<string, unknown>>;
    headers: IncomingHttpHeaders;
    nowMs: number;
  }): Promise<Reply> {
    const found = this.match(input.method, input.path);
    if (found === null) throw notFound();
    const { route, params } = found;

    const request: Request = {
      method: input.method,
      path: input.path,
      params,
      search: input.search,
      body: input.body,
      headers: input.headers,
      nowMs: input.nowMs,
      idempotencyKey: '',
    };

    if (route.kind === 'anonymous') return route.handler(request);

    const token = bearerToken(input.headers.authorization);
    const member = await memberForToken(token);
    if (member === null) throw unauthenticated();

    let carried = request;
    if (route.keyed === true) {
      const key = readIdempotencyKey(input.headers['idempotency-key']);
      carried = { ...request, idempotencyKey: key };
      const replay = await checkReplay(member.actorId, route.pattern, key, input.body);
      if (replay !== null) {
        return {
          status: replay.status,
          bodyText: replay.bodyText,
          headers: { 'Idempotency-Replayed': 'true' },
        };
      }
    }

    const checkRole = (): void => {
      if (route.roles !== undefined && !route.roles.includes(member.role)) throw forbidden();
    };

    switch (route.kind) {
      case 'member': {
        checkRole();
        return route.handler(carried, member);
      }
      case 'asset': {
        const named = params['asset'];
        if (named === undefined || !isAsset(named)) throw notFound();
        checkRole();
        return route.handler(carried, member, named);
      }
      case 'position': {
        const position = await resolvePosition(params['id']);
        checkRole();
        if (route.ownedPosition === true && position.borrowerId !== member.actorId) {
          throw forbidden();
        }
        return route.handler(carried, member, position);
      }
      case 'settlement': {
        const settlementId = await resolveSettlement(params['id']);
        checkRole();
        return route.handler(carried, member, settlementId);
      }
    }
  }
}

async function resolvePosition(named: string | undefined): Promise<ResolvedPosition> {
  if (named === undefined) throw notFound();
  const result = await query<{ position_id: string; borrower_id: string }>(
    'SELECT position_id, borrower_id FROM positions WHERE position_id = $1',
    [named],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound();
  return { positionId: row.position_id, borrowerId: row.borrower_id };
}

async function resolveSettlement(named: string | undefined): Promise<string> {
  if (named === undefined) throw notFound();
  const result = await query<{ settlement_id: string }>(
    'SELECT settlement_id FROM settlements WHERE settlement_id = $1',
    [named],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound();
  return row.settlement_id;
}
