import { connect as netConnect, type Socket } from "node:net";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import { ApiError, errors } from "./errors.js";
import { KillBill } from "./killbill.js";
import { S3 } from "./s3.js";
import { query, withTransaction, type Row } from "./db.js";
import { smtpSend, type MailAttachment } from "./mail.js";

export interface UserCtx {
  id: number;
  name: string;
  email: string;
  role: string;
  organisation_id: string | null;
}

export type Role = "visitor" | "group_booker" | "artist" | "curator" | "box_office" | "finance" | "admin";

export interface MultipartFile {
  fieldName: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  files: Map<string, MultipartFile>;
  user: UserCtx | null;
  app: App;
  cookies: Record<string, string>;
}

export interface Handler {
  (ctx: Ctx): Promise<{ status: number; body?: unknown; headers?: Record<string, string> } | void>;
}

export interface Route {
  method: string;
  pattern: string;
  roles: Role[] | Role | "public" | "signed_in";
  bodyLimit: "json" | "proof" | "artwork" | "none";
  handler: Handler;
}

export interface OutboxAttachment {
  filename: string;
  contentType: string;
  objectKey: string;
}

export class App {
  config: Config;
  killbill: KillBill;
  s3: S3;
  routes: Route[] = [];

  constructor(config: Config) {
    this.config = config;
    this.killbill = new KillBill(config);
    this.s3 = new S3(config);
  }

  signSessionId(sessionId: string): string {
    return createHmac("sha256", this.config.appSecret).update(sessionId).digest("hex").slice(0, 32);
  }

  sessionCookie(sessionId: string): string {
    return `kerf_session=${sessionId}.${this.signSessionId(sessionId)}; HttpOnly; SameSite=Lax; Path=/`;
  }

  clearSessionCookie(): string {
    return "kerf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
  }

  parseSessionCookie(cookies: Record<string, string>): string | null {
    const raw = cookies.kerf_session;
    if (!raw) return null;
    const idx = raw.lastIndexOf(".");
    if (idx < 0) return null;
    const id = raw.slice(0, idx);
    const sig = raw.slice(idx + 1);
    const expected = this.signSessionId(id);
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return id;
  }

  // Short-lived signed links for private objects: the token carries key and expiry.
  signFileToken(objectKey: string, expiresAt: Date): string {
    const payload = `${objectKey}|${Math.floor(expiresAt.getTime() / 1000)}`;
    const b64 = Buffer.from(payload, "utf8").toString("base64url");
    const sig = createHmac("sha256", this.config.appSecret).update(b64).digest("base64url").slice(0, 32);
    return `${b64}.${sig}`;
  }

  verifyFileToken(token: string): { objectKey: string; expiresAt: Date } | null {
    const idx = token.lastIndexOf(".");
    if (idx < 0) return null;
    const b64 = token.slice(0, idx);
    const sig = token.slice(idx + 1);
    const expected = createHmac("sha256", this.config.appSecret).update(b64).digest("base64url").slice(0, 32);
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = Buffer.from(b64, "base64url").toString("utf8");
    const parts = payload.split("|");
    if (parts.length !== 2) return null;
    const exp = Number(parts[1]);
    if (!Number.isFinite(exp)) return null;
    return { objectKey: parts.slice(0, -1).join("|"), expiresAt: new Date(exp * 1000) };
  }

  async queueMail(
    client: { query: (sql: string, args: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }> },
    event: string,
    to: string,
    subject: string,
    bodyText: string,
    attachments: OutboxAttachment[],
    orderRef: string | null = null,
  ): Promise<void> {
    await client.query(
      `insert into outbox (event, to_email, subject, body_text, attachments, status, order_ref)
       values ($1,$2,$3,$4,$5::jsonb,'queued',$6)`,
      [event, to, subject, bodyText, JSON.stringify(attachments), orderRef],
    );
  }

  async smtpHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket: Socket = netConnect({ host: this.config.smtp.host, port: this.config.smtp.port });
      socket.setTimeout(2500, () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
  }

  // One message per event: rows are claimed with an atomic update and the
  // Message-ID is the outbox row id, so it is stable across delivery attempts.
  async deliverOutbox(limit = 5): Promise<void> {
    await query(
      `update outbox set status = 'queued'
       where status = 'sending' and updated_at < now() - interval '30 seconds'`,
      [],
    );
    const claimed = await withTransaction(async (tx) => {
      const res = await tx.query(
        `update outbox set status = 'sending', attempts = attempts + 1, updated_at = now()
         where id in (select id from outbox where status = 'queued' order by id limit $1)
         returning id, event, order_ref, to_email, subject, body_text, attachments`,
        [limit],
      );
      return res.rows as Row[];
    });
    for (const row of claimed) {
      const attachments: MailAttachment[] = [];
      let storageFailed = false;
      for (const a of (row.attachments as Array<{ filename: string; contentType: string; objectKey: string }>) ?? []) {
        try {
          const obj = await this.s3.get(a.objectKey);
          attachments.push({ filename: a.filename, contentType: a.contentType, bytes: obj.body });
        } catch {
          storageFailed = true;
        }
      }
      if (storageFailed) {
        await query("update outbox set status = 'queued' where id = $1", [row.id]);
        continue;
      }
      try {
        await smtpSend(this.config.smtp.host, this.config.smtp.port, {
          from: this.config.mailFrom,
          to: String(row.to_email),
          subject: String(row.subject),
          text: String(row.body_text),
          messageId: `kerf-${row.id}@kerf.example`,
          attachments,
        });
        await query("update outbox set status = 'sent', sent_at = now() where id = $1", [row.id]);
        if (row.event === "order_confirmation" && row.order_ref) {
          await query("update orders set confirmation_mail = 'sent' where id = $1", [row.order_ref]);
        }
      } catch {
        await query("update outbox set status = 'queued' where id = $1", [row.id]);
      }
    }
  }
}

export function cryptoRandom(): string {
  return randomBytes(12).toString("hex");
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

const JSON_LIMIT = 100_000;
const PROOF_LIMIT = 5_000_000;
const ARTWORK_LIMIT = 10_000_000;

export function bodyLimitBytes(limit: Route["bodyLimit"]): number {
  switch (limit) {
    case "json":
      return JSON_LIMIT;
    case "proof":
      return PROOF_LIMIT;
    case "artwork":
      return ARTWORK_LIMIT;
    default:
      return JSON_LIMIT;
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on("data", (c: Buffer) => {
      if (rejected) return;
      size += c.length;
      if (size > limit) {
        rejected = true;
        req.destroy();
        reject(new ApiError(413, { error: "payload_too_large" }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", (e) => {
      if (!rejected) reject(e);
    });
  });
}

export function parseMultipart(body: Buffer, contentTypeHeader: string): Map<string, MultipartFile> {
  const m = /boundary="?([^";]+)"?/i.exec(contentTypeHeader);
  if (!m) throw new ApiError(415, { error: "unsupported_media_type" });
  const boundary = `--${m[1]}`;
  const files = new Map<string, MultipartFile>();
  const raw = body;
  let pos = raw.indexOf(boundary);
  while (pos !== -1) {
    const next = raw.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    const part = raw.slice(pos + boundary.length + 2, next - 2); // strip \r\n before next boundary
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString("utf8");
      const content = part.slice(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
      const fieldName = nameMatch?.[1] ?? "";
      files.set(fieldName, {
        fieldName,
        filename: fileMatch?.[1] ?? "",
        contentType: typeMatch?.[1].trim() ?? "application/octet-stream",
        bytes: content,
      });
    }
    pos = next;
  }
  return files;
}

function matchRoute(routes: Route[], method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const segs = path.split("/").filter((s) => s.length > 0);
  for (const route of routes) {
    if (route.method !== method) continue;
    const rsegs = route.pattern.split("/").filter((s) => s.length > 0);
    if (rsegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < rsegs.length; i += 1) {
      const rs = rsegs[i];
      if (rs.startsWith(":")) {
        params[rs.slice(1)] = decodeURIComponent(segs[i]);
      } else if (rs !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const CLIENT_DIR = join(process.cwd(), "dist", "client");

function serveStatic(res: ServerResponse, pathAfterSlash: string, indexFallback = true): boolean {
  let rel = pathAfterSlash.replace(/^\/+/, "");
  if (rel === "" || !rel.includes(".")) rel = "index.html";
  const target = normalize(join(CLIENT_DIR, rel));
  if (!target.startsWith(normalize(CLIENT_DIR))) return false;
  if (!existsSync(target) || !statSync(target).isFile()) {
    if (!indexFallback) return false;
    const indexPath = join(CLIENT_DIR, "index.html");
    if (!existsSync(indexPath)) return false;
    return emitFile(res, indexPath, "text/html; charset=utf-8");
  }
  const type = STATIC_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
  return emitFile(res, target, type);
}

function emitFile(res: ServerResponse, file: string, contentType: string): boolean {
  try {
    const bytes = readFileSync(file);
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store", "Content-Length": String(bytes.length) });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

export async function createHttpServer(app: App): Promise<http.Server> {
  const staticExts = new Set(Object.keys(STATIC_TYPES));

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;

      if (path.startsWith("/api/")) {
        await handleApi(app, req, res, url);
        return;
      }

      // Never serve anything outside the built browser assets.
      const rel = path.replace(/^\/+/, "");
      const ext = extname(rel).toLowerCase();
      if (rel === "run.json" || rel.startsWith("dist/") || rel.startsWith("src/") || rel.startsWith("..")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      if (ext !== "" && !staticExts.has(ext)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      if (!serveStatic(res, path)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      }
      return;
    } catch (e) {
      if (e instanceof ApiError) {
        sendJson(res, e.status, e.body, e.headers);
        return;
      }
      process.stderr.write(`error: ${e instanceof Error ? e.stack : String(e)}\n`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
      return;
    } finally {
      void started;
    }
  });
  return server;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = Buffer.from(JSON.stringify(body ?? null), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...(headers ?? {}),
  });
  res.end(payload);
}

async function handleApi(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  const match = matchRoute(app.routes, method, path);
  const search = url.searchParams;
  const cookies = parseCookies(req);

  // 1. Size and media type limits come first.
  const bodyLimitKind: Route["bodyLimit"] = match?.route.bodyLimit ?? "none";
  const contentType = req.headers["content-type"] ?? "";
  const contentLength = Number(req.headers["content-length"] ?? "0");

  if (match && bodyLimitKind !== "none") {
    const limit = bodyLimitBytes(bodyLimitKind);
    if (contentLength > limit) throw errors.payloadTooLarge();
    if (bodyLimitKind === "json") {
      if (!/^application\/json/i.test(contentType)) throw errors.unsupportedMediaType();
    } else if (!/^multipart\/form-data/i.test(contentType)) {
      throw errors.unsupportedMediaType();
    }
  }

  // 2. Cross-origin refusal for state-changing requests.
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host ?? "";
      const own = origin.replace(/\/$/, "");
      if (own !== `http://${host}` && own !== `https://${host}`) {
        throw errors.crossOrigin();
      }
    }
  }

  if (!match) {
    throw errors.notFound();
  }

  // Read the body for routes that accept one.
  let body: unknown = null;
  let files = new Map<string, MultipartFile>();
  if (match.route.bodyLimit !== "none") {
    const limit = bodyLimitBytes(match.route.bodyLimit);
    const raw = await readBody(req, limit);
    if (match.route.bodyLimit === "json") {
      try {
        body = raw.length === 0 ? null : JSON.parse(raw.toString("utf8"));
      } catch {
        throw new ApiError(422, { errors: { body: "invalid" } });
      }
    } else {
      files = parseMultipart(raw, contentType);
      body = null;
    }
  }

  // 3. Session. A database outage means no session: public endpoints such as the
  // health check still answer.
  let user: UserCtx | null = null;
  const sessionId = app.parseSessionCookie(cookies);
  if (sessionId) {
    try {
      const found = await query("select * from users where id = (select user_id from login_sessions where id = $1)", [sessionId]);
      const row = found.rows[0];
      if (row) {
        user = {
          id: Number(row.id),
          name: String(row.name),
          email: String(row.email),
          role: String(row.role),
          organisation_id: row.organisation_id === null ? null : String(row.organisation_id),
        };
      }
    } catch {
      user = null;
    }
  }

  const route = match.route;
  if (route.roles !== "public") {
    if (!user) throw errors.unauthenticated();
    const allowed = route.roles === "signed_in"
      ? true
      : Array.isArray(route.roles)
        ? route.roles.includes(user.role as Role)
        : route.roles === user.role;
    if (!allowed) throw errors.forbidden();
  }

  const ctx: Ctx = { req, res, params: match.params, query: search, body, files, user, app, cookies };
  const result = await route.handler(ctx);
  if (result === undefined) {
    sendJson(res, 204, null);
    return;
  }
  if (result.body instanceof Buffer) {
    res.writeHead(result.status, {
      ...(result.headers ?? {}),
      "Content-Length": String(result.body.length),
      "Cache-Control": "no-store",
    });
    res.end(result.body);
    return;
  }
  sendJson(res, result.status, result.body ?? null, result.headers);
}
