/**
 * Request context: the signed-in user, the session cookie, and an async route
 * wrapper so a rejected promise reaches the one error handler.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { User } from '../../shared/types.js';
import { SESSION_COOKIE, userForSession } from '../services/auth.js';
import { SESSION_SECONDS } from '../domain/clock.js';
import { forbidden, unauthenticated } from './errors.js';
import { readCookie } from './app.js';

/**
 * Wrap an async handler so a rejected promise reaches the one error handler.
 * The parameter type is explicit, so a declared route parameter is a string.
 */
export function asyncRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (req: Request<P>, res: Response) => Promise<void>,
): RequestHandler<P> {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export async function currentUser(req: Request): Promise<User | null> {
  return userForSession(readCookie(req, SESSION_COOKIE));
}

/** Any session past its lifetime is unauthenticated, which comes first. */
export async function requireUser(req: Request): Promise<User> {
  const user = await currentUser(req);
  if (!user) throw unauthenticated();
  return user;
}

export async function requireRider(req: Request): Promise<User> {
  const user = await requireUser(req);
  if (user.role !== 'rider') throw forbidden();
  return user;
}

export async function requireFitter(req: Request): Promise<User> {
  const user = await requireUser(req);
  if (user.role !== 'fitter') throw forbidden();
  return user;
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}
