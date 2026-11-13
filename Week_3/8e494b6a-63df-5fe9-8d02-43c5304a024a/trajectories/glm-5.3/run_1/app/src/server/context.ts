/**
 * Request context: session or key auth, space resolution and rate limits.
 * Errors follow the published order: 413/415, 401, 429, 404/410, 403, 409, 422.
 */
import type { NextFunction, Request, Response } from "express";
import type { PoolClient } from "pg";
import { config, rateLimit, type RateKey } from "./config";
import { minuteBucket, nowMs, secondsToNextMinute } from "./clock";
import { ApiError, errors } from "./errors";
import { sha256 } from "./auth";

export interface Ctx {
  kind: "session" | "key";
  userId: string | null;
  username: string | null;
  role: string | null;
  spaceId: string;
  spaceSlug: string;
  keyId: string | null;
  keyActions: string[] | null;
  keyPattern: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    ctx?: Ctx;
  }
}

export async function parseCookies(req: Request): Promise<Record<string, string>> {
  const header = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function loadContext(
  db: PoolClient,
  req: Request,
  spaceParam: string | null,
): Promise<Ctx | null> {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const key = auth.slice(7);
    const hash = sha256(key);
    const res = await db.query(
      "SELECT k.id, k.space_id, k.actions, k.stream_pattern, k.revoked, k.expires_at, s.slug FROM api_keys k JOIN spaces s ON s.id = k.space_id WHERE k.key_hash = $1",
      [hash],
    );
    const row = res.rows[0];
    if (!row) throw errors.keyInvalid();
    if (row.revoked) throw errors.keyRevoked();
    if (row.expires_at && new Date(row.expires_at).getTime() <= nowMs()) throw errors.keyExpired();
    if (spaceParam !== null && spaceParam !== undefined && spaceParam !== row.slug) {
      throw errors.notFound();
    }
    return {
      kind: "key",
      userId: null,
      username: null,
      role: null,
      spaceId: String(row.space_id),
      spaceSlug: String(row.slug),
      keyId: String(row.id),
      keyActions: String(row.actions).split(","),
      keyPattern: String(row.stream_pattern),
    };
  }
  const cookies = await parseCookies(req);
  const token = cookies["spoor_session"];
  if (!token) throw errors.unauthenticated();
  const res = await db.query(
    "SELECT u.id, u.username, u.current_space FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1",
    [token],
  );
  const row = res.rows[0];
  if (!row) throw errors.unauthenticated();
  let slug = spaceParam ?? row.current_space ?? null;
  if (spaceParam) {
    const member = await db.query(
      "SELECT m.role, s.id FROM members m JOIN spaces s ON s.id = m.space_id WHERE s.slug = $1 AND m.user_id = $2",
      [spaceParam, row.id],
    );
    if (member.rows.length === 0) throw errors.notFound();
    slug = spaceParam;
  }
  if (!slug) throw errors.notFound();
  const space = await db.query<{ id: string; slug: string }>("SELECT id, slug FROM spaces WHERE slug = $1", [slug]);
  if (space.rows.length === 0) throw errors.notFound();
  const member = await db.query(
    "SELECT role FROM members WHERE space_id = $1 AND user_id = $2",
    [space.rows[0].id, row.id],
  );
  if (member.rows.length === 0) throw errors.notFound();
  return {
    kind: "session",
    userId: String(row.id),
    username: String(row.username),
    role: String(member.rows[0].role),
    spaceId: String(space.rows[0].id),
    spaceSlug: String(space.rows[0].slug),
    keyId: null,
    keyActions: null,
    keyPattern: null,
  };
}

/** Role order for permission checks. */
export function roleAtLeast(role: string | null, needed: "viewer" | "editor" | "admin"): boolean {
  const rank: Record<string, number> = { viewer: 0, editor: 1, admin: 2 };
  return (rank[role ?? "viewer"] ?? 0) >= rank[needed];
}

export function needRole(ctx: Ctx, needed: "viewer" | "editor" | "admin"): void {
  if (ctx.kind === "key") return;
  if (!roleAtLeast(ctx.role, needed)) throw errors.forbidden();
}

export function needKeyAction(ctx: Ctx, action: "read" | "upload" | "manage", streamName?: string): void {
  if (ctx.kind === "session") return;
  if (!ctx.keyActions?.includes(action)) {
    const verb = action === "upload" ? "upload to" : action === "read" ? "read" : "manage";
    throw errors.keyScope(`This key can't ${verb} stream ${streamName ?? "<name>"}.`);
  }
}

/**
 * The pattern check (rule N): run after the stream resolves, so a stream in another
 * space answers 404 before any 403.
 */
export function keyStreamAllowed(ctx: Ctx, streamName: string): void {
  if (ctx.kind === "session") return;
  const pattern = ctx.keyPattern ?? "";
  const re = new RegExp("^" + pattern.split("*").map(escapeRe).join(".*") + "$");
  const action = ctx.keyActions?.includes("upload")
    ? "upload"
    : ctx.keyActions?.includes("read")
      ? "read"
      : "manage";
  const verb = action === "upload" ? "upload to" : action;
  if (!re.test(streamName) || !ctx.keyActions?.includes(action)) {
    throw errors.keyScope(`This key can't ${verb} stream ${streamName}.`);
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fixed server-clock minute rate windows. */
const rateWindows = new Map<string, Map<number, number>>();

export function hitRate(key: RateKey, identity: string): void {
  const limit = rateLimit(key);
  const bucket = minuteBucket();
  const map = rateWindows.get(key) ?? new Map();
  const current = map.get(identity) ?? new Map<number, number>();
  const count = current.get(bucket) ?? 0;
  if (count >= limit) {
    throw new ApiError(429, "rate_limited", `Too many requests. Try again in ${secondsToNextMinute()} seconds.`, {});
  }
  current.set(bucket, count + 1);
  map.set(identity, current);
  rateWindows.set(key, map);
  // prune old buckets
  for (const [ident, buckets] of map) {
    for (const b of [...buckets.keys()]) {
      if (b < bucket) buckets.delete(b);
    }
    if (buckets.size === 0) map.delete(ident);
  }
}

export function rateIdentity(ctx: Ctx): string {
  return ctx.kind === "key" ? `key:${ctx.keyId}` : `user:${ctx.userId}`;
}
