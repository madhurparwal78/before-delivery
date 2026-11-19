import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors.js';
import { findUserById, hasRole, type AppRole, type Principal } from './identity.js';
import { principalFromBearer } from './oidc.js';
import { readSessionCookie, userIdForSession } from './session.js';

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}

/** Resolves the caller from the session cookie or a realm-issued bearer token. */
export async function attachPrincipal(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authorization = req.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      req.principal = await principalFromBearer(authorization.slice('Bearer '.length).trim());
      next();
      return;
    }
    const sessionId = readSessionCookie(req);
    if (sessionId) {
      const userId = await userIdForSession(sessionId);
      if (userId) {
        const principal = await findUserById(userId);
        if (principal) req.principal = principal;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePrincipal(req: Request): Principal {
  if (!req.principal) throw ApiError.unauthenticated();
  return req.principal;
}

const ROLE_REFUSALS: Readonly<Record<AppRole, string>> = {
  creator: 'Only creator accounts can do this.',
  collector: 'Only collector accounts can do this.',
  'founder-operator': 'Only the founder-operator can do this.',
};

export function requireRole(req: Request, role: AppRole): Principal {
  const principal = requirePrincipal(req);
  if (!hasRole(principal, role)) {
    throw ApiError.forbidden(ROLE_REFUSALS[role]);
  }
  return principal;
}
