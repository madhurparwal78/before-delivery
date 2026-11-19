import type { NextFunction, Request, Response } from "express";
import type { PoolClient } from "pg";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import type { ObjectStorage } from "./object-storage.js";
import { errors } from "./api-errors.js";

export type Role = "lead" | "manager" | "care" | "shopper";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  operatorId: string;
  operatorName: string;
}

export interface StoreRow {
  id: string;
  operator_id: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: "Europe/Lisbon" | "Atlantic/Azores";
  hours_kind: string;
  suspended: boolean;
  suspension_reason: string | null;
}

export interface AuthContext {
  user: SessionUser;
  storeIds: string[];
  sessionExpiresAt: Date;
}

export interface AppLocals {
  cfg: Config;
  db: Database;
  storage: ObjectStorage;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext | undefined;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const locals = res.locals as unknown as AppLocals;
  void locals;
  if (!req.auth) {
    next(errors.unauthenticated());
    return;
  }
  next();
}

export function requireRole(...roles: Role[]): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (!req.auth) {
      next(errors.unauthenticated());
      return;
    }
    if (!roles.includes(req.auth.user.role)) {
      next(errors.forbidden());
      return;
    }
    next();
  };
}

export async function loadSession(req: Request, db: Database, cfg: Config): Promise<AuthContext | null> {
  const token = sessionCookie(req);
  if (!token) return null;
  const client = await db.connect();
  try {
    const result = await client.query<{
      token: string;
      expires_at: Date;
      person_id: string;
      email: string;
      name: string;
      role: Role;
      operator_id: string;
      operator_name: string;
      store_ids: string[] | null;
    }>(
      `SELECT s.token, s.expires_at, s.person_id, p.email, p.name, p.role, p.operator_id, o.name AS operator_name,
            (SELECT array_agg(sm.store_id ORDER BY sm.store_id) FROM store_managers sm WHERE sm.person_id = p.id) AS store_ids
       FROM sessions s
       JOIN people p ON p.id = s.person_id
       JOIN operators o ON o.id = p.operator_id
       WHERE s.token = $1`,
      [token],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query("DELETE FROM sessions WHERE token = $1", [token]);
      return null;
    }
    return {
      user: {
        id: row.person_id,
        name: row.name,
        email: row.email,
        role: row.role,
        operatorId: row.operator_id,
        operatorName: row.operator_name,
      },
      storeIds: row.store_ids ?? [],
      sessionExpiresAt: row.expires_at,
    };
  } finally {
    client.release();
  }
}

function sessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "tramela_session") {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function sessionLanding(role: Role, storeIds: string[]): string {
  if (role === "lead") return "/estate";
  if (role === "care") return "/care";
  if (role === "shopper") return "/catalogue";
  return `/shop/${storeIds[0] ?? ""}`;
}

export async function visibleStore(client: PoolClient, auth: AuthContext, storeId: string): Promise<StoreRow | null> {
  const result = await client.query<StoreRow>("SELECT * FROM stores WHERE id = $1 AND operator_id = $2", [storeId, auth.user.operatorId]);
  return result.rows[0] ?? null;
}
