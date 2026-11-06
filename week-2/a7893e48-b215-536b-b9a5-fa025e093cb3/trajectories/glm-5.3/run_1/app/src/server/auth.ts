import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { q } from "./db.js";
import { verifyPassword } from "./seed.js";
import { ApiError, unauthenticated } from "./errors.js";
import type { SessionUser, Role } from "../shared/types.js";

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const b64 = (b: Buffer) => b.toString("base64url");
const sign = (payload: string) => b64(crypto.createHmac("sha256", SECRET).update(payload).digest());

export function makeSession(userId: string): string {
  const payload = b64(Buffer.from(JSON.stringify({ u: userId, t: Date.now() + 14 * 86400000 })));
  return `${payload}.${sign(payload)}`;
}

export function parseSession(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig || sign(payload) !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; t: number };
    if (data.t < Date.now()) return null;
    return data.u;
  } catch {
    return null;
  }
}

export async function loadUser(req: Request): Promise<SessionUser | null> {
  const userId = parseSession(req.cookies?.hs_session);
  if (!userId) return null;
  const r = await q(
    `SELECT u.id, u.name, u.email, u.role, u.operator_id, u.site_ids, u.renter_id
     FROM app_users u WHERE u.id = $1`, [userId],
  );
  const row = r.rows[0] as { id: string; name: string; email: string; role: Role; operator_id: string; site_ids: string[]; renter_id: string | null } | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, operator_id: row.operator_id, site_ids: row.site_ids, renter_id: row.renter_id };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function requireUser(req: Request): SessionUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}

export async function checkCredentials(email: string, password: string): Promise<SessionUser | null> {
  const r = await q(
    `SELECT id, name, email, role, operator_id, site_ids, renter_id, password_hash
     FROM app_users WHERE lower(email) = lower($1)`, [email],
  );
  const row = r.rows[0] as (SessionUser & { password_hash: string }) | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.id + row.email, row.password_hash)) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, operator_id: row.operator_id, site_ids: row.site_ids, renter_id: row.renter_id };
}

export function sendError(res: Response, err: ApiError): void {
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  Object.assign(body, err.extra);
  res.status(err.status).json(body);
}

export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
