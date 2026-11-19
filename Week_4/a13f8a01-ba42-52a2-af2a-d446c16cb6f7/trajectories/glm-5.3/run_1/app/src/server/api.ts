import type { IncomingMessage, ServerResponse } from "node:http";
import type { PoolClient } from "pg";
import type { App } from "./server.js";
import { sendJson, send404, readBody, parseJsonBody } from "./http.js";
import { errorBody, validationBody } from "../shared/errors.js";
import { SHELF } from "../shared/shelf.js";
import { parseCookies, SESSION_COOKIE, userFromSession, createSession, hashPassword, verifyPassword, newToken } from "./auth.js";
import {
  canSee, getPen, getVisiblePen, getVersionRow, countLikes, countForks, penTags, forkedFromFor, newId, isoTime,
  type PenRow, type UserRow, type VersionRow,
} from "./domain.js";
import {
  listPens, createPen, getPenRoute, patchPen, deletePenRoute, listVersions, getVersionRoute, diffRoute,
  saveVersion, restoreVersion, forkPen, likePen, exportPen,
} from "./pens.js";
import {
  search, createRender, listCollections, createCollection, getCollectionRoute, patchCollection,
  deleteCollectionRoute, addPenToCollection, removePenFromCollection,
} from "./misc.js";

const HANDLE_RE = /^[a-z0-9-]{3,20}$/;
const TAG_RE = /^[a-z0-9-]{1,24}$/;
const IDEM_RE = /^[\x20-\x7E]{1,64}$/;

export interface ApiCtx {
  app: App;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  path: string;
  user: UserRow | null;
  body: unknown;
  raw: Buffer | null;
  sessionToken: string | undefined;
}

export async function handleApi(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const path = url.pathname;
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  let raw: Buffer | null = null;
  if (hasBody) {
    const result = await readBody(req, app.config.bodyLimitBytes);
    if (!result.ok) {
      sendJson(res, 413, errorBody("body_too_large", "The request body is too large."));
      return;
    }
    raw = result.buf;
  }
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE];
  let user: UserRow | null = null;
  if (sessionToken) {
    try {
      user = await userFromSession(app.db, sessionToken);
    } catch {
      user = null;
    }
  }
  if (hasBody && sessionToken && req.headers.origin !== undefined) {
    const origin = req.headers.origin.endsWith("/") ? req.headers.origin.slice(0, -1) : req.headers.origin;
    if (origin !== app.config.publicUrl) {
      sendJson(res, 403, errorBody("forbidden", "Cross-site request refused."));
      return;
    }
  }
  const ctx: ApiCtx = {
    app,
    req,
    res,
    url,
    method,
    path,
    user,
    body: raw !== null ? parseJsonBody(raw) : {},
    raw,
    sessionToken,
  };

  if (path.startsWith("/api/grading/")) {
    if (!app.config.grading) {
      send404(res);
      return;
    }
    const { handleGradingSeed, handleGradingSession } = await import("./grading.js");
    if (path === "/api/grading/seed" && method === "POST") return handleGradingSeed(ctx);
    if (path === "/api/grading/session" && method === "POST") return handleGradingSession(ctx);
    send404(res);
    return;
  }

  try {
    await routeApi(ctx);
  } catch (e) {
    const code = e instanceof HttpError ? e : null;
    if (code) {
      sendJson(res, code.status, code.body);
      return;
    }
    sendJson(res, 503, errorBody("storage_unavailable", "Storage is unreachable."));
  }
}

export class HttpError extends Error {
  constructor(public status: number, public body: unknown) {
    super("http error");
  }
}

export function requireUser(ctx: ApiCtx): UserRow {
  if (!ctx.user) throw new HttpError(401, errorBody("not_signed_in", "Sign in to do this."));
  return ctx.user;
}

export function requireVerified(user: UserRow): void {
  if (!user.verified) {
    throw new HttpError(403, errorBody("unverified", "Verify your email to do this."));
  }
}

function setSession(res: ServerResponse, token: string): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
}

function clearSession(res: ServerResponse): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

async function routeApi(ctx: ApiCtx): Promise<void> {
  const { app, method, path, res } = ctx;
  const m = (want: string) => method === want;

  if (path === "/api/health" && m("GET")) {
    const dbOk = await app.db.ping().catch(() => false);
    const storeOk = await app.storage.ping().catch(() => false);
    const mailOk = await pingMail(app);
    sendJson(res, 200, { status: dbOk && storeOk && mailOk ? "ok" : "unavailable" });
    return;
  }

  if (path === "/api/config" && m("GET")) {
    const c = app.config;
    sendJson(res, 200, {
      preview_delay_ms: c.previewDelayMs,
      draft_interval_ms: c.draftIntervalMs,
      search_debounce_ms: c.searchDebounceMs,
      loop_limit: c.loopLimit,
      pane_limit_bytes: c.paneLimitBytes,
      max_tags: c.maxTags,
      live_poll_ms: c.livePollMs,
    });
    return;
  }

  if (path === "/api/shelf" && m("GET")) {
    sendJson(res, 200, { libraries: shelfJson(app) });
    return;
  }

  if (path === "/api/signup" && m("POST")) return signup(ctx);
  if (path === "/api/signin" && m("POST")) return signin(ctx);
  if (path === "/api/signout" && m("POST")) return signout(ctx);
  if (path === "/api/me" && m("GET")) return me(ctx);
  if (path === "/api/verify" && m("POST")) return verifyToken(ctx);
  if (path === "/api/verify/resend" && m("POST")) return resend(ctx);
  if (path === "/api/pens" && m("GET")) return listPens(ctx);
  if (path === "/api/pens" && m("POST")) return createPen(ctx);
  if (path === "/api/search" && m("GET")) return search(ctx);
  if (path === "/api/renders" && m("POST")) return createRender(ctx);
  if (path === "/api/collections" && m("GET")) return listCollections(ctx);
  if (path === "/api/collections" && m("POST")) return createCollection(ctx);

  const penMatch = /^\/api\/pens\/([a-z0-9]{10})(\/.*)?$/.exec(path);
  if (penMatch) {
    const penId = penMatch[1]!;
    const rest = penMatch[2] ?? "";
    if (rest === "" && m("GET")) return getPenRoute(ctx, penId);
    if (rest === "" && m("PATCH")) return patchPen(ctx, penId);
    if (rest === "" && m("DELETE")) return deletePenRoute(ctx, penId);
    if (rest === "/versions" && m("GET")) return listVersions(ctx, penId);
    if (rest === "/versions" && m("POST")) return saveVersion(ctx, penId);
    if (rest.startsWith("/versions/")) {
      const n = Number(rest.slice("/versions/".length));
      if (m("GET") && Number.isInteger(n) && n >= 1) return getVersionRoute(ctx, penId, n);
      send404(res);
      return;
    }
    if (rest === "/diff" && m("GET")) return diffRoute(ctx, penId);
    if (rest === "/restore" && m("POST")) return restoreVersion(ctx, penId);
    if (rest === "/fork" && m("POST")) return forkPen(ctx, penId);
    if (rest === "/like" && m("PUT")) return likePen(ctx, penId, true);
    if (rest === "/like" && m("DELETE")) return likePen(ctx, penId, false);
    if (rest === "/export" && m("GET")) return exportPen(ctx, penId);
    send404(res);
    return;
  }

  const colMatch = /^\/api\/collections\/([a-z0-9]{10})(\/.*)?$/.exec(path);
  if (colMatch) {
    const colId = colMatch[1]!;
    const rest = colMatch[2] ?? "";
    if (rest === "" && m("GET")) return getCollectionRoute(ctx, colId);
    if (rest === "" && m("PATCH")) return patchCollection(ctx, colId);
    if (rest === "" && m("DELETE")) return deleteCollectionRoute(ctx, colId);
    if (rest === "/pens" && m("POST")) return addPenToCollection(ctx, colId);
    if (rest.startsWith("/pens/") && m("DELETE")) {
      return removePenFromCollection(ctx, colId, rest.slice("/pens/".length));
    }
    send404(res);
    return;
  }

  send404(res);
}

// ---------- json shapes ----------

function shelfJson(app: App): unknown[] {
  return SHELF.map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version,
    global: s.global,
    path: `/shelf/${s.id}/${s.file}`,
    license: s.license,
    bytes: app.shelfBytes.get(s.id) ?? 0,
    sha256: app.shelfSha256.get(s.id) ?? "",
  }));
}

export function userJson(u: UserRow): unknown {
  return { id: u.id, handle: u.handle, email: u.email, verified: u.verified };
}

export function versionJson(v: VersionRow): unknown {
  return {
    pen_id: v.pen_id,
    number: v.number,
    created_at: isoTime(v.created_at),
    sha256: v.sha256,
    files: { html: v.html, css: v.css, js: v.js },
    libraries: v.libraries,
    restored_from: v.restored_from,
  };
}

export function versionEntryJson(v: VersionRow): unknown {
  return {
    number: v.number,
    created_at: isoTime(v.created_at),
    sha256: v.sha256,
    restored_from: v.restored_from,
    added: v.added,
    removed: v.removed,
    changed_chars: v.changed_chars,
  };
}

export async function penJson(app: App, client: PoolClient, pen: PenRow, viewerId: string | null): Promise<unknown> {
  const likes = await countLikes(client, pen.id);
  const forks = await countForks(client, pen.id);
  const tags = await penTags(client, pen.id);
  const likedRow = viewerId
    ? await client.query("SELECT 1 FROM likes WHERE user_id = $1 AND pen_id = $2", [viewerId, pen.id])
    : null;
  const forked_from = await forkedFromFor(client, pen, viewerId);
  let version: unknown = null;
  if (pen.head > 0) {
    const v = await getVersionRow(client, pen.id, pen.head);
    if (v) version = versionJson(v);
  }
  const owner = await client.query<{ handle: string }>("SELECT handle FROM users WHERE id = $1", [pen.owner_id]);
  return {
    id: pen.id,
    title: pen.title,
    owner: owner.rows[0]?.handle ?? "",
    visibility: pen.visibility,
    tags,
    head: pen.head,
    updated_at: isoTime(pen.updated_at),
    likes,
    forks,
    liked: likedRow !== null && likedRow.rowCount === 1,
    forked_from,
    version,
  };
}

export async function penSummaryJson(client: PoolClient, pen: PenRow): Promise<unknown> {
  const likes = await countLikes(client, pen.id);
  const forks = await countForks(client, pen.id);
  const tags = await penTags(client, pen.id);
  const owner = await client.query<{ handle: string }>("SELECT handle FROM users WHERE id = $1", [pen.owner_id]);
  return {
    id: pen.id,
    title: pen.title,
    owner: owner.rows[0]?.handle ?? "",
    visibility: pen.visibility,
    tags,
    head: pen.head,
    updated_at: isoTime(pen.updated_at),
    likes,
    forks,
  };
}

// ---------- accounts ----------

function validEmail(email: string): boolean {
  const at = email.indexOf("@");
  if (at <= 0 || email.indexOf("@", at + 1) !== -1) return false;
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

async function signup(ctx: ApiCtx): Promise<void> {
  const { app, res, body } = ctx;
  const b = (body ?? {}) as Record<string, unknown>;
  const handle = String(b.handle ?? "");
  const email = String(b.email ?? "");
  const password = String(b.password ?? "");
  const fields: Record<string, string> = {};
  if (!HANDLE_RE.test(handle)) fields.handle = "Use 3 to 20 lowercase letters, digits or hyphens.";
  if (!validEmail(email)) fields.email = "Enter an email address like name@example.com.";
  if (password.length < 10) fields.password = "Use at least 10 characters.";
  if (Object.keys(fields).length > 0) {
    sendJson(res, 422, validationBody(fields));
    return;
  }
  const taken = await app.db.withClient(async (client) => {
    const h = await client.query("SELECT 1 FROM users WHERE handle = $1", [handle]);
    if (h.rowCount === 1) return { handle: true } as const;
    const e = await client.query("SELECT 1 FROM users WHERE email_lower = $1", [email.toLowerCase()]);
    if (e.rowCount === 1) return { email: true } as const;
    return null;
  });
  if (taken) {
    const field = taken.handle ? "handle" : "email";
    const message = taken.handle ? "That handle is taken." : "That email already has an account.";
    sendJson(res, 409, { error: "duplicate", message: "That handle or email is taken.", fields: { [field]: message } });
    return;
  }
  const userId = newId();
  try {
    await app.db.query(
      "INSERT INTO users (id, handle, email, email_lower, password_hash, verified) VALUES ($1, $2, $3, $4, $5, FALSE)",
      [userId, handle, email, email.toLowerCase(), hashPassword(password)],
    );
  } catch {
    sendJson(res, 503, errorBody("storage_unavailable", "Storage is unreachable."));
    return;
  }
  const sent = await sendVerificationEmail(app, userId);
  const session = await createSession(app.db, userId);
  setSession(res, session);
  sendJson(res, 201, { user: { id: userId, handle, email, verified: false }, verification: sent ? "sent" : "pending" });
}

async function sendVerificationEmail(app: App, userId: string): Promise<boolean> {
  const token = newToken();
  const expires = new Date(Date.now() + app.config.verifyTtlSeconds * 1000);
  await app.db.query("UPDATE verify_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE", [userId]);
  await app.db.query("INSERT INTO verify_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, expires]);
  const user = (await app.db.query<UserRow>("SELECT id, handle, email, password_hash, verified FROM users WHERE id = $1", [userId]))[0];
  if (!user) return false;
  return app.mail.send({
    to: user.email,
    subject: "Verify your Ashlar account",
    text: `Hi ${user.handle},\n\nOpen this link to verify your email: ${app.config.publicUrl}/verify?token=${token}\n`,
  });
}

async function signin(ctx: ApiCtx): Promise<void> {
  const { app, res, body } = ctx;
  const b = (body ?? {}) as Record<string, unknown>;
  const email = String(b.email ?? "");
  const password = String(b.password ?? "");
  const user = (await app.db.query<UserRow>(
    "SELECT id, handle, email, password_hash, verified FROM users WHERE email_lower = $1",
    [email.toLowerCase()],
  ))[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    sendJson(res, 401, errorBody("bad_credentials", "That email or password is not right."));
    return;
  }
  const session = await createSession(app.db, user.id);
  setSession(res, session);
  sendJson(res, 200, { user: userJson(user) });
}

async function signout(ctx: ApiCtx): Promise<void> {
  requireUser(ctx);
  const { app, res, sessionToken } = ctx;
  if (sessionToken) await app.db.query("DELETE FROM sessions WHERE token = $1", [sessionToken]);
  clearSession(res);
  sendJson(res, 204, undefined);
  res.end();
}

async function me(ctx: ApiCtx): Promise<void> {
  const user = requireUser(ctx);
  sendJson(ctx.res, 200, { user: userJson(user) });
}

async function verifyToken(ctx: ApiCtx): Promise<void> {
  const { app, res, body } = ctx;
  const token = String((body as Record<string, unknown>)?.token ?? "");
  const row = (await app.db.query<{ user_id: string; expires_at: Date; used: boolean }>(
    "SELECT user_id, expires_at, used FROM verify_tokens WHERE token = $1",
    [token],
  ))[0];
  if (!row || row.used) {
    sendJson(res, 422, errorBody("token_invalid", "This link is not valid. It may have been used already."));
    return;
  }
  if (row.expires_at.getTime() <= Date.now()) {
    sendJson(res, 422, errorBody("token_expired", "This link has expired. Sign in and use Resend link to get a new one."));
    return;
  }
  await app.db.withClient(async (client) => {
    const updated = await client.query("UPDATE verify_tokens SET used = TRUE WHERE token = $1 AND used = FALSE RETURNING user_id", [token]);
    if (updated.rowCount === 0) throw new Error("used");
    await client.query("UPDATE users SET verified = TRUE WHERE id = $1", [row.user_id]);
    const u = await client.query<UserRow>("SELECT id, handle, email, password_hash, verified FROM users WHERE id = $1", [row.user_id]);
    const user = u.rows[0];
    if (user) {
      sendJson(res, 200, { user: userJson(user) });
      app.events.accountVerified(user.id);
    }
  });
}

async function resend(ctx: ApiCtx): Promise<void> {
  const user = requireUser(ctx);
  if (user.verified) {
    sendJson(ctx.res, 409, errorBody("already_verified", "Your email is already verified."));
    return;
  }
  const sent = await sendVerificationEmail(ctx.app, user.id);
  if (!sent) {
    sendJson(ctx.res, 503, errorBody("mail_unavailable", "Mail is unreachable, so the link was not sent. Try again in a moment."));
    return;
  }
  sendJson(ctx.res, 202, { verification: "sent" });
}

async function pingMail(app: App): Promise<boolean> {
  // Health must not consume real messages; a SMTP NOOP style check: connect and close.
  try {
    const net = await import("node:net");
    return await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: app.config.smtp.host, port: app.config.smtp.port });
      socket.setTimeout(2500);
      socket.on("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}
