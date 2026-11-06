import { readJsonBody, readMultipartFile } from "../http/body.js";
import { errors } from "../http/errors.js";
import { requireRole, isStaff, clientIp } from "../http/context.js";
import { createSession, sessionCookie, clearedCookie, endSession, publicMember } from "../domain/sessions.js";
import type { RouteContext } from "./table.js";
import { ROLE_HOME } from "../../shared/domain.js";

/** Shared helpers for route handlers. */

export async function jsonBody(ctx: RouteContext): Promise<Record<string, unknown>> {
  return readJsonBody(ctx.req);
}

export function member(ctx: RouteContext) {
  if (!ctx.auth) throw errors.unauthenticated();
  return ctx.auth.member;
}

export function staff(ctx: RouteContext) {
  const m = member(ctx);
  if (!isStaff(m)) throw errors.forbidden();
  return m;
}

export function director(ctx: RouteContext) {
  const m = member(ctx);
  requireRole(m, ["agency_director"]);
  return m;
}

export function role(ctx: RouteContext, roles: string[]) {
  const m = member(ctx);
  requireRole(m, roles);
  return m;
}

export async function signInResponse(ctx: RouteContext, memberId: string, home?: string): Promise<unknown> {
  const session = await createSession(memberId);
  ctx.res.setHeader("Set-Cookie", sessionCookie(session.token, session.expiresAt));
  return { member: publicMember(ctx.auth!.member), home: home || ROLE_HOME[ctx.auth!.member.role] || "/workspace/board" };
}

export async function signOut(ctx: RouteContext): Promise<void> {
  await endSession(ctx.auth!.sessionToken);
  ctx.res.setHeader("Set-Cookie", clearedCookie());
}

export function status(ctx: RouteContext, code: number): void {
  ctx.res.locals.status = code;
}

export { readMultipartFile, clientIp, publicMember };
