import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db.js';
import { getUser, type PbUser } from '../services/pocketbase.js';

export interface SessionInfo {
  user: PbUser;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string | null;
      role?: string | null;
      sessionId?: string | null;
    }
  }
}

export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export async function createSession(userId: string): Promise<string> {
  const token = newSessionToken();
  await pool.query('insert into sessions (token, user_id) values ($1, $2)', [token, userId]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await pool.query('delete from sessions where token = $1', [token, ]);
}

class StoreUnavailable extends Error {}

export async function attachUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionToken = req.cookies?.ceibo_session;
  req.userId = null;
  req.role = null;
  if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
    next();
    return;
  }
  try {
    const q = await pool.query<{ user_id: string }>('select user_id from sessions where token = $1', [sessionToken]);
    if (q.rows.length === 0) {
      next();
      return;
    }
    req.sessionId = sessionToken;
    req.userId = q.rows[0].user_id;
    try {
      const user = await getUser(q.rows[0].user_id);
      req.role = user.role;
    } catch {
      // PocketBase unreachable: keep the session so existing sessions keep working.
    }
    next();
  } catch {
    res.status(503).json({ error: 'store_unavailable', message: "The shop can't update right now. Try again in a moment." });
  }
}

export class RequireSessionError extends Error {
  constructor(public kind: 'unauthenticated' | 'store' | 'role') {
    super(kind);
  }
}

export async function requireUser(req: Request): Promise<SessionInfo> {
  if (!req.sessionId || !req.userId) {
    const sessionToken = req.cookies?.ceibo_session;
    if (typeof sessionToken === 'string' && sessionToken.length > 0) {
      throw new RequireSessionError('store');
    }
    throw new RequireSessionError('unauthenticated');
  }
  try {
    const user = await getUser(req.userId);
    return { user, sessionId: req.sessionId };
  } catch {
    throw new RequireSessionError('store');
  }
}

export async function requireRole(req: Request, roles: string[]): Promise<SessionInfo> {
  const info = await requireUser(req);
  if (!info.user.role || !roles.includes(info.user.role)) {
    throw new RequireSessionError('role');
  }
  return info;
}

export { StoreUnavailable };
