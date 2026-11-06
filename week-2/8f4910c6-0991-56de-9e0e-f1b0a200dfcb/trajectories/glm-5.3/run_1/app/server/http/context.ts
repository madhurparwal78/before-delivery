import type { Request, Response } from "express";
import { errors, ApiError } from "../http/errors.js";
import { loadAuth, type AuthContext, type SessionMember } from "../domain/sessions.js";

export interface Ctx {
  req: Request;
  res: Response;
  auth: AuthContext | null;
  member: SessionMember | null;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;

/** Runs a handler with the published precedence for unauthenticated requests. */
export async function run(handler: Handler, req: Request, res: Response): Promise<void> {
  const auth = await loadAuth(req).catch((err) => {
    throw err;
  });
  const ctx: Ctx = { req, res, auth, member: auth ? auth.member : null };
  const out = await handler(ctx);
  if (out !== undefined && !res.headersSent) {
    if (out === null) res.status(204).end();
    else res.status(res.statusCode || 200).json(out);
  }
}

/** Requires a signed-in member. Throws the ladder's 401s. */
export function requireAuth(ctx: Ctx): SessionMember {
  if (!ctx.auth) throw errors.unauthenticated();
  return ctx.auth.member;
}

export function requireRole(member: SessionMember, roles: string[]): void {
  if (!roles.includes(member.role)) throw errors.forbidden();
}

export function isStaff(member: SessionMember): boolean {
  return ["agency_director", "booker", "accounts_lead", "scout"].includes(member.role);
}

export function isDirector(member: SessionMember): boolean {
  return member.role === "agency_director";
}

export function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).trim();
  return req.socket.remoteAddress || "unknown";
}

export function assert(cond: unknown, err: ApiError): void {
  if (!cond) throw err;
}
