import { randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Database } from './db';
import type { DbRow } from './querier';
import type { Role } from '../shared/domain';
import { sha256Hex } from './hashutil';
import { ERR } from './errors';
import type { EvidenceStore } from './evidence';
import type { MailRelay } from './mail';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthedRequest extends Request {
  sessionUser?: SessionUser;
  sessionTokenHash?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
      sessionTokenHash?: string;
    }
  }
}

export interface AppServices {
  db: Database;
  evidence: EvidenceStore;
  mail: MailRelay;
  latestSeq(): Promise<number>;
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: sha256Hex(token) };
}

/** Resolves the caller from the strata_session cookie; the role is read fresh from the database (DP-02). */
export async function resolveUser(db: Database, tokenHash: string | undefined): Promise<SessionUser | null> {
  if (!tokenHash) return null;
  const row = await db.queryOne<UserDbRow>(
    `SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [tokenHash]
  );
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role as Role };
}

interface UserDbRow extends DbRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function requireSession(db: Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = (req.cookies?.strata_session as string | undefined) ?? undefined;
    const tokenHash = token ? sha256Hex(token) : undefined;
    resolveUser(db, tokenHash)
      .then((user) => {
        if (!user) {
          res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
          return;
        }
        req.sessionUser = user;
        req.sessionTokenHash = tokenHash;
        next();
      })
      .catch(next);
  };
}

export function requireRole(roles: readonly Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.sessionUser;
    if (!user) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
      return;
    }
    if (!(roles as readonly string[]).includes(user.role)) {
      res.status(403).json({ error: { code: 'forbidden', message: "You don't have permission to do that." } });
      return;
    }
    next();
  };
}

export function actorOf(req: Request): SessionUser {
  const u = req.sessionUser;
  if (!u) throw ERR.unauthenticated();
  return u;
}

/** The commit-time authority recheck (DP-09): reads session and role inside the transaction. */
export async function recheckAuthority(
  tx: { queryOne<T extends DbRow>(sql: string, params?: unknown[]): Promise<T | null> },
  tokenHash: string | undefined,
  roles: readonly Role[]
): Promise<SessionUser | null> {
  if (!tokenHash) return null;
  const row = await tx.queryOne<UserDbRow>(
    `SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [tokenHash]
  );
  if (!row) return null;
  if (!(roles as readonly string[]).includes(row.role)) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role as Role };
}
