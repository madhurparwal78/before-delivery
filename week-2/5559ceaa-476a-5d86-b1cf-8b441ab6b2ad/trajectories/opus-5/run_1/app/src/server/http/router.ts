import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MemberRole, User } from '../../shared/api.js';
import { limits } from '../config.js';
import { pool } from '../db.js';
import { loadMembership, type ProjectRow } from '../repository.js';
import { currentUser } from '../services/authSession.js';
import {
  asRecord,
  parseJsonBody,
  readBody,
  readHeader,
  type BodyKind,
} from './context.js';
import {
  crossOrigin,
  methodNotAllowed,
  notFound,
  unauthenticated,
} from './errors.js';

export interface Reply {
  status: number;
  payload?: unknown;
  headers?: Record<string, string>;
}

export interface BaseContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly body: Buffer;
  fields(): Record<string, unknown>;
  header(name: string): string | undefined;
}

export interface AuthContext extends BaseContext {
  readonly user: User;
}

export interface ProjectContext extends AuthContext {
  readonly project: ProjectRow;
  readonly role: MemberRole;
}

export type Route =
  | { method: '*'; pattern: string; scope: 'method_not_allowed' }
  | {
      method: string;
      pattern: string;
      scope: 'public';
      body: BodyKind;
      handler: (ctx: BaseContext) => Promise<Reply>;
    }
  | {
      method: string;
      pattern: string;
      scope: 'auth';
      body: BodyKind;
      handler: (ctx: AuthContext) => Promise<Reply>;
    }
  | {
      method: string;
      pattern: string;
      scope: 'project';
      body: BodyKind;
      handler: (ctx: ProjectContext) => Promise<Reply>;
    };

interface Matched {
  route: Route;
  params: Record<string, string>;
}

function match(routes: readonly Route[], method: string, pathname: string): Matched | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  for (const route of routes) {
    if (route.method !== '*' && route.method !== method) continue;
    const expected = route.pattern.split('/').filter((part) => part !== '');
    if (expected.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let index = 0; index < expected.length; index += 1) {
      const slot = expected[index] ?? '';
      const value = parts[index] ?? '';
      if (slot.startsWith(':')) params[slot.slice(1)] = decodeURIComponent(value);
      else if (slot !== value) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function assertSameOrigin(req: IncomingMessage, ownOrigin: string): void {
  if (!WRITE_METHODS.has(req.method ?? '')) return;
  const origin = readHeader(req, 'origin');
  if (origin === undefined) return;
  if (origin !== ownOrigin) throw crossOrigin();
}

export async function dispatch(
  routes: readonly Route[],
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ownOrigin: string,
): Promise<Reply> {
  const method = req.method ?? 'GET';
  const matched = match(routes, method, url.pathname);
  if (matched === null) throw notFound();
  const { route, params } = matched;
  if (route.scope === 'method_not_allowed') throw methodNotAllowed();

  const limit = route.body === 'zip' ? limits.zipBytes : limits.jsonBytes;
  const body = await readBody(req, route.body, limit);

  const base: BaseContext = {
    req,
    res,
    url,
    params,
    body,
    fields: () => asRecord(parseJsonBody(body)),
    header: (name) => readHeader(req, name),
  };

  if (route.scope === 'public') {
    assertSameOrigin(req, ownOrigin);
    return route.handler(base);
  }

  const user = await currentUser(req);
  if (user === null) throw unauthenticated();

  if (route.scope === 'auth') {
    assertSameOrigin(req, ownOrigin);
    return route.handler({ ...base, user });
  }

  const projectId = params['project_id'] ?? '';
  const membership = await loadMembership(pool, projectId, user.id);
  assertSameOrigin(req, ownOrigin);
  return route.handler({ ...base, user, project: membership.project, role: membership.role });
}
