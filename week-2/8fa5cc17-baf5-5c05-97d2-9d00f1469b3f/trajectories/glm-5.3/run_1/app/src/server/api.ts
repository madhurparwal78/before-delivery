// The workspace API dispatcher: session, settings, sign-in and password
// routes live here; resource handlers are in api2.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Ctx } from "./context.js";
import type { LiveSync } from "./sync.js";
import { recordEvent } from "./sync.js";
import {
  sessionLabel,
  createSession,
  findSession,
  touchSession,
  isLocked,
  isAddrLocked,
  recordFailure,
  clearFailures,
  pruneIdleSessions,
  type SessionRow,
} from "./sessions.js";
import { verifyPassword, hashPassword } from "./password.js";
import { HttpError, header, readBody, JSON_BODY_CAP, type ApiRequest, type RouteResult } from "./api-utils.js";
import { isZoneName } from "../shared/hometime.js";
import {
  handleTypes,
  handleObjects,
  handleBlocks,
  handleDaily,
  handleAttachmentDownload,
  handleCollections,
  handleShareLinkActions,
  handleGraph,
  handleSearch,
  handleQueries,
  handleTimeline,
  handleAttachmentUpload,
} from "./api2.js";

const SESSION_COOKIE = "quire_session";

export type { ApiRequest, RouteResult };

function clientAddr(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

function parseCookie(headerStr: string): string | null {
  for (const part of headerStr.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

function expiredCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function safeJson(req: ApiRequest): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body.toString("utf8"));
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export async function handleApi(ctx: Ctx, sync: LiveSync, req: IncomingMessage, res: ServerResponse, method: string, path: string, query: URLSearchParams): Promise<RouteResult> {
  const isHealth = method === "GET" && path === "/api/health";
  const isSignIn = method === "POST" && path === "/api/auth/sign-in";
  const isUpload = method === "POST" && /\/attachments\/?$/.test(path);

  const cookieHeader = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  const sessionId = parseCookie(cookieHeader);
  let session: SessionRow | null = null;
  if (sessionId !== null && !isHealth) session = await findSession(ctx, sessionId);
  const apiReq: ApiRequest = {
    method,
    path,
    query,
    body: Buffer.alloc(0),
    headers: req.headers,
    session,
    raw: req,
  };

  if (isHealth) {
    if (!ctx.dbReady) return { status: 503, body: { status: "starting" } };
    return { status: 200, body: { status: "ok" } };
  }

  // error precedence: 413 and 415 before authentication
  if ((method === "POST" || method === "PUT" || method === "PATCH") && !isUpload) {
    const { ok, tooLarge } = await readBody(req, JSON_BODY_CAP + 1048576);
    apiReq.body = ok ?? Buffer.alloc(0);
    if (tooLarge || apiReq.body.length > JSON_BODY_CAP) throw new HttpError(413, { error: "too_large" });
    if (apiReq.body.length > 0) {
      const ct = (header(apiReq, "content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (ct !== "application/json") throw new HttpError(415, { error: "unsupported_media_type" });
    }
  }

  if (isSignIn) {
    return handleSignIn(ctx, apiReq, clientAddr(req));
  }

  // authentication
  if (session === null) throw new HttpError(401, { error: "unauthenticated" });
  // CSRF on every change
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    const token = header(apiReq, "x-csrf-token");
    if (token !== session.csrf_token) throw new HttpError(403, { error: "csrf_failed" });
  }
  await touchSession(ctx, session.id);

  if (method === "GET" && path === "/api/session") {
    const owner = await ctx.pool.query<{ email: string; display_name: string }>("SELECT email, display_name FROM owner_account LIMIT 1");
    return {
      status: 200,
      body: {
        user: { email: owner.rows[0]?.email ?? "", display_name: owner.rows[0]?.display_name ?? "" },
        csrf_token: session.csrf_token,
        session_id: session.public_id,
        home_time_zone: ctx.homeTimeZone,
        theme: ctx.theme,
      },
    };
  }
  if (method === "POST" && path === "/api/auth/sign-out") {
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM sessions WHERE id = $1", [session.id]);
      await recordEvent(client, "sessions.changed", {});
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    sync.sessionEnded(session.id);
    return { status: 204, body: null, setCookie: expiredCookie() };
  }
  if (path === "/api/account/password" && method === "POST") {
    return handlePasswordChange(ctx, sync, apiReq);
  }
  if (method === "GET" && path === "/api/sessions") {
    await pruneIdleSessions(ctx);
    const rows = await ctx.pool.query<{ id: string; label: string; created_at: Date; last_seen_at: Date }>(
      "SELECT public_id AS id, label, created_at, last_seen_at FROM sessions ORDER BY created_at DESC"
    );
    return {
      status: 200,
      body: {
        sessions: rows.rows.map((r) => ({
          id: r.id,
          label: r.label,
          created_at: r.created_at.toISOString(),
          last_seen_at: r.last_seen_at.toISOString(),
          current: r.id === session.public_id,
        })),
      },
    };
  }
  if (method === "DELETE" && path.startsWith("/api/sessions/")) {
    const handle = path.slice("/api/sessions/".length);
    if (handle === session.public_id) throw new HttpError(409, { error: "current_session" });
    const client = await ctx.pool.connect();
    let endedId: string | null = null;
    try {
      await client.query("BEGIN");
      const del = await client.query<{ id: string }>("DELETE FROM sessions WHERE public_id = $1 RETURNING id", [handle]);
      if (del.rows.length > 0) {
        endedId = del.rows[0].id;
        await recordEvent(client, "sessions.changed", {});
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    if (endedId === null) throw new HttpError(404, { error: "not_found" });
    sync.sessionEnded(endedId);
    return { status: 204, body: null };
  }
  if (method === "GET" && path === "/api/settings") {
    return { status: 200, body: { home_time_zone: ctx.homeTimeZone, theme: ctx.theme } };
  }
  if (method === "PUT" && path === "/api/settings") {
    const body = safeJson(apiReq);
    const errors: Record<string, string> = {};
    let zone = ctx.homeTimeZone;
    let theme = ctx.theme;
    if ("home_time_zone" in body) {
      const z = body.home_time_zone;
      if (typeof z !== "string" || !isZoneName(z)) errors.home_time_zone = "Choose a time zone from the list.";
      else zone = z;
    }
    if ("theme" in body) {
      const t = body.theme;
      if (t !== "paper" && t !== "lamplight") errors.theme = "Choose Paper or Lamplight.";
      else theme = t;
    }
    if (Object.keys(errors).length > 0) throw new HttpError(422, { error: "validation", errors });
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE settings SET home_time_zone = $1, theme = $2 WHERE id = 1", [zone, theme]);
      await recordEvent(client, "settings.saved", { home_time_zone: zone, theme });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    ctx.homeTimeZone = zone;
    ctx.theme = theme;
    return { status: 200, body: { home_time_zone: zone, theme } };
  }
  if (path.startsWith("/api/types")) {
    return handleTypes(ctx, apiReq, method, path);
  }
  if (path.startsWith("/api/objects")) {
    return handleObjects(ctx, sync, apiReq, method, path);
  }
  if (path.startsWith("/api/blocks")) {
    return handleBlocks(ctx, sync, apiReq, method, path);
  }
  if (path.startsWith("/api/daily")) {
    return handleDaily(ctx, sync, apiReq, method, path);
  }
  if (path.startsWith("/api/attachments")) {
    return handleAttachmentDownload(ctx, apiReq, path);
  }
  if (isUpload) {
    return handleAttachmentUpload(ctx, sync, req, apiReq);
  }
  if (path === "/api/storage" && method === "GET") {
    const available = await ctx.s3.available();
    return { status: 200, body: { storage: available ? "available" : "unavailable" } };
  }
  if (path.startsWith("/api/collections")) {
    return handleCollections(ctx, sync, apiReq, method, path);
  }
  if (path.startsWith("/api/share-links/")) {
    return handleShareLinkActions(ctx, sync, apiReq, method, path);
  }
  if (path === "/api/graph" && method === "GET") {
    return handleGraph(ctx, apiReq);
  }
  if (path === "/api/search" && method === "GET") {
    return handleSearch(ctx, apiReq);
  }
  if (path.startsWith("/api/queries")) {
    return handleQueries(ctx, sync, apiReq, method, path);
  }
  if (path === "/api/timeline" && method === "GET") {
    return handleTimeline(ctx, apiReq);
  }
  throw new HttpError(404, { error: "not_found" });
}

// ---------------------------------------------------------------------------
// Sign-in and password

async function handleSignIn(ctx: Ctx, req: ApiRequest, addr: string): Promise<RouteResult> {
  const body = safeJson(req);
  const errors: Record<string, string> = {};
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (email.length === 0) errors.email = "Give your email.";
  if (password.length === 0) errors.password = "Give your password.";
  if (Object.keys(errors).length > 0) throw new HttpError(422, { error: "validation", errors });

  const norm = email.trim().toLowerCase();
  const identity = `email:${norm}`;
  const window = ctx.config.lockoutWindowSeconds;
  const emailLock = await isLocked(ctx.pool, identity, window);
  const addrLock = await isAddrLocked(ctx.pool, addr, window);
  const locked = emailLock.locked ? emailLock : addrLock;
  if (locked.locked) {
    return { status: 429, body: { error: "locked" }, headers: { "Retry-After": String(locked.retryAfter) } };
  }
  const owner = await ctx.pool.query<{ email_norm: string; password_hash: string; display_name: string; email: string }>(
    "SELECT email_norm, password_hash, display_name, email FROM owner_account LIMIT 1"
  );
  let ok = false;
  if (owner.rows.length > 0) {
    ok = owner.rows[0].email_norm === norm && (await verifyPassword(password, owner.rows[0].password_hash));
  }
  if (!ok) {
    await recordFailure(ctx.pool, identity, addr, window);
    const emailLock2 = await isLocked(ctx.pool, identity, window);
    if (emailLock2.locked) return { status: 429, body: { error: "locked" }, headers: { "Retry-After": String(emailLock2.retryAfter) } };
    const addrLock2 = await isAddrLocked(ctx.pool, addr, window);
    if (addrLock2.locked) return { status: 429, body: { error: "locked" }, headers: { "Retry-After": String(addrLock2.retryAfter) } };
    throw new HttpError(401, { error: "invalid_credentials" });
  }
  await clearFailures(ctx.pool, identity);
  const label = sessionLabel(header(req, "user-agent") ?? "");
  const client = await ctx.pool.connect();
  let created: SessionRow | null = null;
  try {
    await client.query("BEGIN");
    created = await createSession(client, label);
    await recordEvent(client, "sessions.changed", {});
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return {
    status: 200,
    body: {
      user: { email: owner.rows[0].email, display_name: owner.rows[0].display_name },
      csrf_token: created.csrf_token,
    },
    setCookie: `${SESSION_COOKIE}=${created.id}; HttpOnly; SameSite=Lax; Path=/`,
  };
}

async function handlePasswordChange(ctx: Ctx, sync: LiveSync, req: ApiRequest): Promise<RouteResult> {
  const body = safeJson(req);
  const errors: Record<string, string> = {};
  const current = typeof body.current_password === "string" ? body.current_password : "";
  const next = typeof body.new_password === "string" ? body.new_password : "";
  const owner = await ctx.pool.query<{ password_hash: string }>("SELECT password_hash FROM owner_account LIMIT 1");
  const okCurrent = owner.rows.length > 0 ? await verifyPassword(current, owner.rows[0].password_hash) : false;
  if (!okCurrent) errors.current_password = "That isn't your current password.";
  if (next.length < 12) errors.new_password = "Use at least 12 characters.";
  if (next.length > 200) errors.new_password = "Use at most 200 characters.";
  if (Object.keys(errors).length > 0) throw new HttpError(422, { error: "validation", errors });

  const hash = await hashPassword(next);
  const label = sessionLabel(header(req, "user-agent") ?? "");
  const client = await ctx.pool.connect();
  let newSession: SessionRow | null = null;
  let endedIds: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query("UPDATE owner_account SET password_hash = $1", [hash]);
    const ended = await client.query<{ id: string }>("SELECT id FROM sessions WHERE id <> $1", [req.session?.id]);
    endedIds = ended.rows.map((r) => r.id);
    await client.query("DELETE FROM sessions WHERE id <> $1", [req.session?.id]);
    await client.query("DELETE FROM sessions WHERE id = $1", [req.session?.id]);
    newSession = await createSession(client, label);
    await recordEvent(client, "sessions.changed", {});
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  for (const id of endedIds) sync.sessionEnded(id);
  // the current device keeps working: its stream closes and reconnects
  sync.closeSession(req.session?.id ?? "");
  return {
    status: 200,
    body: { csrf_token: newSession.csrf_token },
    setCookie: `${SESSION_COOKIE}=${newSession.id}; HttpOnly; SameSite=Lax; Path=/`,
  };
}
