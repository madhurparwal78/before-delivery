import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { loadConfig } from './config.js';
import { SESSION_COOKIE, type SessionPerson } from './session.js';
import { unauthenticated } from './errors.js';
import { personById, type PersonRec, type Role } from './register.js';
import { dateStr } from './pgtypes.js';

export interface Ctx {
  req: Request;
  res: Response;
  person: SessionPerson;
  client: PoolClient;
  params: Record<string, string>;
  body: unknown;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface RouteDef {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  roles: Role[] | 'signed-in' | 'anyone';
}

const routes: RouteDef[] = [];

/** Registers an API route. `roles` is 'anyone' for unauthenticated endpoints, 'signed-in' for any active person. */
export function route(method: string, path: string, roles: RouteDef['roles'], handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$',
  );
  routes.push({ method, pattern, keys, handler, roles });
}

export function matchRoute(method: string, path: string): (RouteDef & { params: Record<string, string> }) | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
      return { ...r, params };
    }
  }
  return null;
}

/** Loads the signed-in person for a session token; null when the session or access is gone. */
export async function loadSessionPerson(req: Request): Promise<SessionPerson | null> {
  const token = (req.cookies?.[SESSION_COOKIE] ?? undefined) as string | undefined;
  if (!token) return null;
  const r = await pool.query(
    `SELECT s.token, p.id, p.name, p.first_name, p.email, p.role, p.access,
            p.terminated_at, p.termination_date, p.window_ends_at
     FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = $1`,
    [token],
  );
  const row = r.rows[0] as
    | {
        token: string; id: string; name: string; first_name: string; email: string;
        role: Role; access: string; terminated_at: Date | null; termination_date: string | null;
        window_ends_at: Date | null;
      }
    | undefined;
  if (!row || row.access !== 'active') return null;
  return {
    id: row.id,
    name: row.name,
    first_name: row.first_name,
    email: row.email,
    role: row.role,
    access: 'active',
    terminated_at: row.terminated_at ? new Date(row.terminated_at).toISOString() : null,
    termination_date: dateStr(row.termination_date),
    window_ends_at: row.window_ends_at ? new Date(row.window_ends_at).toISOString() : null,
  };
}

export function requirePerson(ctx: Pick<Ctx, 'person'>): SessionPerson {
  if (!ctx.person) throw unauthenticated();
  return ctx.person;
}

export function requireRole(person: SessionPerson, roles: Role[]): void {
  if (!roles.includes(person.role)) {
    const e = new Error('Your role may not do this.') as Error & { status?: number; code?: string };
    e.status = 403;
    e.code = 'forbidden';
    throw e;
  }
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function personJson(p: PersonRec): Record<string, unknown> {
  const cfg = loadConfig();
  const warnings: string[] = [];
  if (p.window_ends_at && p.terminated_at) {
    for (const w of cfg.leaverWarningsSeconds) {
      const at = new Date(p.window_ends_at.getTime() - w * 1000);
      if (at > p.terminated_at) warnings.push(at.toISOString());
    }
    warnings.sort();
  }
  return {
    id: p.id,
    name: p.name,
    first_name: p.first_name,
    email: p.email,
    role: p.role,
    access: p.access,
    departure: p.terminated_at
      ? {
          terminated_at: p.terminated_at.toISOString(),
          termination_date: dateStr(p.termination_date),
          window_ends_at: p.window_ends_at ? p.window_ends_at.toISOString() : null,
          warnings_at: warnings,
        }
      : null,
  };
}

export async function fetchPerson(client: PoolClient, id: string): Promise<PersonRec | null> {
  return personById(client, id);
}

export function nowISO(at: Date): string {
  return at.toISOString();
}
