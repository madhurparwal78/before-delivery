/** Handler helpers: the signed-in user, JSON bodies, response envelopes. */

import type { RouteContext, RequestContext } from "../server.js";
import { readBodyUtf8, jsonBodyLimit, visibleAscii } from "../server.js";
import { err, validation, notFound } from "../errors.js";
import { Db } from "../../db.js";
import type { User, Role } from "../../../shared/api-types.js";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenant_id: string | null;
}

export async function loadUser(db: Db, userId: string): Promise<UserRow | null> {
  const rows = await db.query<UserRow>(
    "SELECT id, email, name, role, tenant_id FROM users WHERE id = $1",
    [userId]
  );
  return rows[0] ?? null;
}

export function userJson(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, role: row.role, tenant_id: row.tenant_id };
}

export async function requireUser(rc: RouteContext): Promise<UserRow> {
  const user = await loadUser(rc.db, rc.ctx.userId ?? "");
  if (user === null) {
    throw err(401, "unauthenticated", "Sign in to continue.");
  }
  return user;
}

export function requireRole(user: UserRow, roles: Role[]): void {
  if (!roles.includes(user.role)) {
    throw err(403, "forbidden", "You can't do that with this account.");
  }
}

export async function readJson(ctx: RequestContext): Promise<Record<string, unknown>> {
  const contentType = ctx.req.headers["content-type"] ?? "";
  if (!contentType.startsWith("application/json")) {
    throw err(415, "unsupported_media_type", "That kind of content isn't accepted.");
  }
  const text = await readBodyUtf8(ctx, jsonBodyLimit, "body_too_large");
  if (text.trim() === "") return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw err(422, "validation_failed", "Check the highlighted fields.", { body: "Body must be JSON." });
  }
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function int(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
}

/** A tenant user asking for another tenant's record gets the same 404 as an unknown ID. */
export function assertSameTenant(user: UserRow, tenantId: string): void {
  if (user.tenant_id !== null && user.tenant_id !== tenantId) {
    throw notFound();
  }
}

export async function loadOwnBooking(rc: RouteContext, user: UserRow, bookingId: string) {
  const rows = await rc.db.query<{ id: string; tenant_id: string }>(
    "SELECT id, tenant_id FROM bookings WHERE id = $1",
    [bookingId]
  );
  if (rows.length === 0) {
    throw notFound();
  }
  if (user.tenant_id !== null && rows[0].tenant_id !== user.tenant_id) {
    throw notFound();
  }
  return rows[0];
}

/** The Idempotency-Key a route requires, validated for shape and presence. */
export function requireIdempotencyKey(ctx: RequestContext): string {
  const key = visibleAscii(ctx.req.headers["idempotency-key"]);
  if (key === null) {
    throw err(400, "idempotency_key_required", "Send an Idempotency-Key header with this request.");
  }
  return key;
}

export const json = (status: number, value: unknown): { status: number; body: string } => ({
  status,
  body: JSON.stringify(value)
});

export const noContent = (): { status: number; body: string } => ({ status: 204, body: "" });
