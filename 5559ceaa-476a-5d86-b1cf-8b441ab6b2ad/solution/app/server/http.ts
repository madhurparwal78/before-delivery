import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { one, pool } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { StorageUnavailable } from "./storage.js";

const JSON_LIMIT = 2_000_000;
const ZIP_LIMIT = 5_000_000;
export const FRAME_LIMIT = 2_000_000;
export const COOKIE = "rb_session";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface User {
  id: string;
  email: string | null;
  name: string;
  kind: "mentor" | "learner";
}

export type Json = Record<string, unknown>;

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  user: User;
  raw: Buffer;
  json(): Json;
  header(name: string): string | undefined;
}

type BodyKind = "json" | "zip";

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  body: BodyKind;
  auth: boolean;
  private: boolean;
  handler: (ctx: Ctx) => Promise<Reply>;
}

const routes: Route[] = [];

export function route(
  method: string,
  path: string,
  handler: (ctx: Ctx) => Promise<Reply>,
  options: { body?: BodyKind; auth?: boolean; private?: boolean } = {},
): void {
  const keys: string[] = [];
  const source = path.replace(/:([a-z_]+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({
    method,
    pattern: new RegExp(`^${source}$`),
    keys,
    body: options.body ?? "json",
    auth: options.auth ?? true,
    private: options.private ?? false,
    handler,
  });
}

export const ok = (body: unknown, status = 200): Reply => ({ status, body });
export const noContent = (headers?: Record<string, string>): Reply => ({ status: 204, headers });

export const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) jar[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return jar;
}

export function sessionCookie(token: string): string {
  const secure = config.publicUrl.startsWith("https:") ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function userFromCookie(req: IncomingMessage): Promise<User | null> {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  return (
    (await one<User>(
      pool,
      `SELECT u.id, u.email, u.name, u.kind FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
      [hashToken(token)],
    )) ?? null
  );
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  return origin === config.publicOrigin || (host !== undefined && (origin === `http://${host}` || origin === `https://${host}`));
}

function send(res: ServerResponse, reply: Reply, extra: Record<string, string> = {}): void {
  const headers: Record<string, string> = { ...extra, ...reply.headers };
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body), "utf8");
  res.writeHead(reply.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      if (!over) chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Sends any failure in the catalogued error shape. */
export function sendError(res: ServerResponse, error: unknown, extra: Record<string, string> = {}): void {
  send(res, errorReply(error), extra);
}

function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) return { status: error.status, body: error.body() };
  if (!(error instanceof StorageUnavailable)) console.error(error);
  const unavailable = new ApiError("storage_unavailable");
  return { status: unavailable.status, body: unavailable.body() };
}

/** Answers an /api/ request, applying the brief's error precedence before the handler runs. */
export async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  let matched: Route | undefined;
  let values: string[] = [];
  let getOnly = false;
  for (const candidate of routes) {
    const hit = candidate.pattern.exec(url.pathname);
    if (!hit) continue;
    if (candidate.private) getOnly = true;
    if (candidate.method === method) {
      matched = candidate;
      values = hit.slice(1);
      break;
    }
  }
  if (!matched && getOnly) {
    req.resume();
    send(res, errorReply(new ApiError("method_not_allowed")), PRIVATE_HEADERS);
    return;
  }
  if (!matched) {
    req.resume();
    send(res, errorReply(new ApiError("not_found")));
    return;
  }
  const current = matched;
  const extra = current.private ? PRIVATE_HEADERS : {};
  try {
    const hasBody = Number(req.headers["content-length"] ?? "0") > 0 || req.headers["transfer-encoding"] !== undefined;
    const wanted = current.body === "zip" ? "application/zip" : "application/json";
    if ((hasBody || current.body === "zip") && mediaType(req) !== wanted) {
      req.resume();
      throw new ApiError("unsupported_media_type");
    }
    const limit = current.body === "zip" ? ZIP_LIMIT : JSON_LIMIT;
    const raw = await readBody(req, limit);
    if (raw === null) throw new ApiError("too_large", { limit_bytes: limit });
    const params: Record<string, string> = {};
    current.keys.forEach((key, i) => (params[key] = decodeURIComponent(values[i]!)));
    let user: User | null = null;
    if (current.auth) {
      user = await userFromCookie(req);
      if (!user) throw new ApiError("unauthenticated");
    }
    for (const [key, value] of Object.entries(params)) {
      if (key !== "token" && !UUID.test(value)) throw new ApiError("not_found");
    }
    if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) throw new ApiError("cross_origin");
    let parsed: Json | undefined;
    const ctx: Ctx = {
      req,
      url,
      params,
      user: user as User,
      raw,
      header: (name) => {
        const value = req.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
      },
      json: () => {
        if (parsed) return parsed;
        if (raw.length === 0) return (parsed = {});
        let value: unknown;
        try {
          value = JSON.parse(raw.toString("utf8"));
        } catch {
          throw invalid({ body: "The body must be a JSON object." });
        }
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw invalid({ body: "The body must be a JSON object." });
        }
        return (parsed = value as Json);
      },
    };
    send(res, await current.handler(ctx), extra);
  } catch (error) {
    send(res, errorReply(error), extra);
  }
}
