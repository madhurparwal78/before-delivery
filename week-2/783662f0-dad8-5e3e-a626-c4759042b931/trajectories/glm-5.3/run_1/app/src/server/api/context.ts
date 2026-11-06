/** The request context: session, membership scoping, ETags and idempotency. */

import type { Pool } from "../db/pool.js";
import type { Request } from "express";
import { apiError, type ApiError } from "./errors.js";
import { sessionUser, type SessionUser } from "./sessions.js";
import { validateIdempotencyKey } from "./validation.js";
import { newId } from "../db/seed.js";

export interface ServerRow {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  status: string;
  plan: "hamlet" | "borough";
  time_zone: string;
  season: number;
  weather_seed: number;
  suspends_at: Date | null;
  kb_checked_at: Date | null;
}

export interface Context {
  user: SessionUser;
}

/** The signed-in user, or the 401 error. */
export async function requireUser(pool: Pool, req: Request): Promise<SessionUser | ApiError> {
  const user = await sessionUser(pool, req);
  if (user === null) return apiError(401, "unauthenticated", "Sign in to continue.");
  return user;
}

export function isUser(value: SessionUser | ApiError): value is SessionUser {
  return (value as SessionUser).handle !== undefined;
}

/** The server by slug, only for its members. Non-members get the same 404 as unknown slugs. */
export async function memberServer(pool: Pool, slug: string, userId: string): Promise<{ server: ServerRow; role: "owner" | "member" } | ApiError> {
  const res = await pool.query<ServerRow>("SELECT * FROM servers WHERE slug = $1", [slug]);
  const server = res.rows[0];
  if (server === undefined) return apiError(404, "not_found", "Not found.");
  const member = await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [server.id, userId]);
  if (member.rows.length === 0) return apiError(404, "not_found", "Not found.");
  return { server, role: server.owner_id === userId ? "owner" : "member" };
}

/** The server context with the signed-in user attached. */
export async function serverContext(pool: Pool, req: { headers: Record<string, unknown> }): Promise<ServerContext | ApiError> {
  const u = await requireUser(pool, req as never);
  if (!isUser(u)) return u;
  const slug = (req as unknown as { params: Record<string, string> }).params.slug ?? "";
  const found = await memberServer(pool, slug, u.id);
  if ("server" in found) return { server: found.server, role: found.role, user: u };
  return found;
}

export function isServer(value: { server: ServerRow; role: "owner" | "member" } | ApiError): value is { server: ServerRow; role: "owner" | "member" } {
  return (value as { server: ServerRow }).server !== undefined;
}

export function ownerOnly(role: "owner" | "member"): ApiError | null {
  if (role !== "owner") return apiError(403, "forbidden", "Only the owner may do that.");
  return null;
}

/** The character must exist on that server and belong to the session user. */
export async function ownCharacter(pool: Pool, serverId: string, userId: string, characterId: string): Promise<{ id: string; world_id: string; name: string; x: number; y: number } | ApiError> {
  const res = await pool.query<{ id: string; server_id: string; user_id: string; world_id: string; name: string; x: number; y: number }>(
    "SELECT id, server_id, user_id, world_id, name, x, y FROM characters WHERE id = $1",
    [characterId]
  );
  const row = res.rows[0];
  if (row === undefined || row.server_id !== serverId) return apiError(404, "not_found", "Not found.");
  if (row.user_id !== userId) return apiError(403, "not_your_character", "That character belongs to another player.");
  return { id: row.id, world_id: row.world_id, name: row.name, x: row.x, y: row.y };
}

export function isCharacter(value: { id: string; world_id: string; name: string; x: number; y: number } | ApiError): value is { id: string; world_id: string; name: string; x: number; y: number } {
  return (value as { id: string }).id !== undefined;
}

/** The 423 gates: a suspended or not-yet-active server refuses play. */
export function playGate(status: string): ApiError | null {
  if (status === "suspended") {
    return apiError(423, "server_suspended", "This server is suspended. Play and saves resume once the billing provider confirms payment.", { retryAfter: 10 });
  }
  if (status === "pending_approval") {
    return apiError(423, "server_inactive", "This server is waiting for its first payment to be confirmed.", { retryAfter: 10 });
  }
  return null;
}

/** Strong ETag of a record: a quoted value that changes whenever the record changes. */
export function strongEtag(parts: unknown[]): string {
  return `"${parts.join(":")}"`;
}

/** If-Match handling for PUT and PATCH. */
export function checkIfMatch(req: Request, currentEtag: string | null): ApiError | null {
  const given = req.headers["if-match"];
  if (given === undefined || (typeof given === "string" && given.trim() === "")) {
    return apiError(428, "precondition_required", "Send If-Match with the current ETag.");
  }
  const givenValue = (Array.isArray(given) ? given[0] : given).replace(/^"|"$/g, "");
  if (currentEtag === null || givenValue !== currentEtag.replace(/^"|"$/g, "")) {
    return apiError(412, "precondition_failed", "This changed since you opened it. The latest version is now shown.", { etag: currentEtag ?? "" });
  }
  return null;
}

/** The idempotency key check. */
export function idempotencyError(key: string | undefined): ApiError | null {
  const message = validateIdempotencyKey(key);
  if (message !== undefined) {
    return apiError(422, "validation", message, { fields: { idempotency_key: message } });
  }
  return null;
}

export interface StoredResponse {
  status: number;
  body: string;
}

/** Looks up a stored idempotent response. Keys are scoped to the user and endpoint. */
export async function findIdempotent(pool: Pool, userId: string, endpoint: string, key: string): Promise<StoredResponse | null> {
  const res = await pool.query<{ status: number; body: string }>(
    "SELECT status, body FROM idempotency_records WHERE user_id = $1 AND endpoint = $2 AND key = $3",
    [userId, endpoint, key]
  );
  const row = res.rows[0];
  return row === undefined ? null : { status: row.status, body: row.body };
}

export async function storeIdempotent(pool: Pool, userId: string, endpoint: string, key: string, status: number, body: string): Promise<void> {
  if (status >= 500) return;
  await pool.query(
    `INSERT INTO idempotency_records (user_id, endpoint, key, status, body) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, endpoint, key) DO NOTHING`,
    [userId, endpoint, key, status, body]
  );
}

export async function idempotencyBodyDiffers(pool: Pool, userId: string, endpoint: string, key: string, body: string): Promise<boolean | null> {
  const res = await pool.query<{ body: string }>(
    "SELECT body FROM idempotency_records WHERE user_id = $1 AND endpoint = $2 AND key = $3",
    [userId, endpoint, key]
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return row.body !== body;
}

export function newRecordId(): string {
  return newId();
}

export interface ServerObject {
  id: string;
  slug: string;
  name: string;
  owner: string;
  role: "owner" | "member";
  status: string;
  status_word: string;
  suspends_at: string | null;
  suspends_at_label: string | null;
  time_zone: string;
  plan: string;
  season: number;
  worlds: { slug: string; name: string }[];
  member_count: number;
  character_count: number;
}

/** The Server object, with the viewer's role. */
export async function serverObject(pool: Pool, server: ServerRow, userId: string): Promise<ServerObject> {
  const owner = (await pool.query<{ handle: string }>("SELECT handle FROM users WHERE id = $1", [server.owner_id])).rows[0];
  const worlds = await pool.query<{ slug: string; name: string }>("SELECT slug, name FROM worlds WHERE server_id = $1 ORDER BY slug", [server.id]);
  const counts = await pool.query<{ member_count: string; character_count: string }>(
    `SELECT (SELECT count(*) FROM members WHERE server_id = $1)::text AS member_count,
            (SELECT count(*) FROM characters WHERE server_id = $1)::text AS character_count`,
    [server.id]
  );
  const { zoneLabelWithZone, isoInstant } = await import("../time.js");
  return {
    id: server.id,
    slug: server.slug,
    name: server.name,
    owner: owner?.handle ?? "",
    role: server.owner_id === userId ? "owner" : "member",
    status: server.status,
    status_word: server.status === "pending_approval" ? "PENDING" : server.status === "active" ? "PAID" : server.status === "past_due" ? "PAST DUE" : "SUSPENDED",
    suspends_at: server.suspends_at === null ? null : isoInstant(server.suspends_at),
    suspends_at_label: server.suspends_at === null ? null : zoneLabelWithZone(server.suspends_at, server.time_zone),
    time_zone: server.time_zone,
    plan: server.plan,
    season: server.season,
    worlds: worlds.rows,
    member_count: Number(counts.rows[0]?.member_count ?? 0),
    character_count: Number(counts.rows[0]?.character_count ?? 0),
  };
}

/** The server's strong ETag. */
export async function serverEtag(pool: Pool, serverId: string): Promise<string | null> {
  const row = (await pool.query<{ status: string; plan: string; season: number; time_zone: string; pending_plan: string | null; updated: Date }>(
    "SELECT status, plan, season, time_zone, pending_plan, kb_checked_at AS updated FROM servers WHERE id = $1",
    [serverId]
  )).rows[0];
  if (row === undefined) return null;
  return `"${serverId}:${row.status}:${row.plan}:${row.season}:${row.time_zone}:${row.pending_plan ?? ""}:${row.updated?.getTime() ?? 0}"`;
}

export type SessionUserLike = {
  id: string;
  handle: string;
  display_name: string;
  sound_on: boolean;
};

export type ServerContext = { server: ServerRow; role: "owner" | "member"; user: SessionUserLike };

/** A character in the route path, resolved with membership and server status. */
export async function ownCharacterByRoute(
  pool: Pool,
  req: { params: Record<string, string | undefined> },
  userId: string
): Promise<{ id: string; server_id: string; world_id: string; name: string; x: number; y: number; status: string } | { error: ApiError }> {
  const row = (await pool.query<{ id: string; server_id: string; user_id: string; world_id: string; name: string; x: number; y: number }>(
    "SELECT id, server_id, user_id, world_id, name, x, y FROM characters WHERE id = $1",
    [req.params.id ?? ""]
  )).rows[0];
  if (row === undefined) return { error: apiError(404, "not_found", "Not found.") };
  const member = await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [row.server_id, userId]);
  if (member.rows.length === 0) return { error: apiError(404, "not_found", "Not found.") };
  if (row.user_id !== userId) return { error: apiError(403, "not_your_character", "That character belongs to another player.") };
  const status = (await pool.query<{ status: string }>("SELECT status FROM servers WHERE id = $1", [row.server_id])).rows[0];
  return { id: row.id, server_id: row.server_id, world_id: row.world_id, name: row.name, x: row.x, y: row.y, status: status?.status ?? "" };
}
