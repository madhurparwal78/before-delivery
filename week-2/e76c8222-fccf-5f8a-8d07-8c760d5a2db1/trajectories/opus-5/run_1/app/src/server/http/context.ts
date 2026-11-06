import { Request } from 'express';
import { Role } from '../../shared/types';
import { fail } from './errors';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export function requireAuth(req: Request): AuthUser {
  if (!req.authUser) throw fail('unauthenticated');
  return req.authUser;
}

export function requireRoles(req: Request, roles: readonly Role[]): AuthUser {
  const user = requireAuth(req);
  if (!roles.includes(user.role)) throw fail('forbidden');
  return user;
}

export function requireOrgUser(req: Request): AuthUser & { org_id: string } {
  const user = requireRoles(req, ['requester']);
  if (!user.org_id) throw fail('forbidden');
  return user as AuthUser & { org_id: string };
}

export function jsonObject(req: Request): Record<string, unknown> {
  const body = req.body as unknown;
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) throw fail('bad_json');
  return body as Record<string, unknown>;
}

export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) throw fail('not_found');
  return value;
}
