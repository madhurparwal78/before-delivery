import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ROLES, type Role } from "../shared/rules.js";
import { one, pool } from "./db.js";
import { forbidden, HttpError } from "./errors.js";
import type { Auth, Ctx, Pipeline, Route } from "./http.js";
import { takeToken } from "./valkey.js";

export const SESSION_COOKIE = "pv_session";

export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export function realmRoles(roles: readonly string[] | undefined): Role[] {
  return ROLES.filter((role) => (roles ?? []).includes(role));
}

export async function createSession(memberId: string, roles: Role[], venueId: string | null): Promise<string> {
  const id = randomToken();
  await pool.query("INSERT INTO sessions (id_hash, member_id, roles, venue_id) VALUES ($1, $2, $3, $4)", [hash(id), memberId, roles, venueId]);
  return id;
}

export async function endSession(id: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE id_hash = $1", [hash(id)]);
}

const unauthenticated = () => new HttpError(401, { error: "unauthenticated" });

/** `pv_<12 hex id>_<40 hex>`; only the hash of the secret is stored. */
const KEY_FORMAT = /^pv_([0-9a-f]{12})_([0-9a-f]{40})$/;

async function keyAuth(secret: string): Promise<Auth> {
  const match = KEY_FORMAT.exec(secret);
  if (!match) throw unauthenticated();
  const row = await one<{ id: string; secret_hash: string; member_id: string; roles: Role[]; venue_id: string | null }>(
    pool,
    `SELECT k.id, k.secret_hash, k.member_id, m.roles, m.venue_id FROM api_keys k JOIN members m ON m.id = k.member_id
      WHERE k.id = $1 AND k.revoked_at IS NULL`,
    [match[1]],
  );
  if (!row || !timingSafeEqual(Buffer.from(row.secret_hash), Buffer.from(hash(secret))) || !row.roles.includes("builder")) {
    throw unauthenticated();
  }
  return { memberId: row.member_id, roles: row.roles, venueId: row.venue_id, keyId: row.id };
}

export const pipeline: Pipeline = {
  async authenticate(ctx: Ctx, route: Route): Promise<Auth> {
    const header = ctx.req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      const auth = await keyAuth(header.slice(7).trim());
      if (!route.key) throw forbidden();
      return auth;
    }
    const id = ctx.cookies[SESSION_COOKIE];
    if (!id) throw unauthenticated();
    const session = await one<{ member_id: string; roles: Role[]; venue_id: string | null }>(
      pool,
      "SELECT member_id, roles, venue_id FROM sessions WHERE id_hash = $1",
      [hash(id)],
    );
    if (!session) throw unauthenticated();
    return { memberId: session.member_id, roles: session.roles, venueId: session.venue_id, keyId: null };
  },
  async rateLimit(keyId: string): Promise<void> {
    const wait = await takeToken(keyId);
    if (wait > 0) {
      throw new HttpError(429, { error: "rate_limited", retry_after_ms: wait }, { "Retry-After": String(Math.ceil(wait / 1000)) });
    }
  },
};

// ---- guards (step 6 of the error precedence: missing role or no venue) ----

export function signedIn(ctx: Ctx): Auth {
  if (!ctx.auth) throw unauthenticated();
  return ctx.auth;
}

/** A venue member with one of `roles` (any venue role when none is given). */
export function requireRole(auth: Auth, ...roles: Role[]): string {
  if (auth.venueId === null) throw forbidden();
  const allowed = roles.length === 0 ? auth.roles.some((role) => role !== "founder_operator") : roles.some((role) => auth.roles.includes(role));
  if (!allowed) throw forbidden();
  return auth.venueId;
}

export function requireFounder(auth: Auth): void {
  if (!auth.roles.includes("founder_operator")) throw forbidden();
}
