import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Config } from "./config.js";
import { errors } from "./errors.js";
import { JSON_CONTENT_TYPE, MAX_JSON_BYTES, parseMultipart, readBody } from "./http.js";

export interface Member {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  role: "head_of_product" | "product_manager" | "customer_success";
}

export type Role = Member["role"];
export type RoleSpec = Role[] | "any" | "public";

export interface UploadedFile {
  filename: string;
  contentType: string | null;
  bytes: Buffer;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  config: Config;
  pool: Pool;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  member: Member | null;
  body: Record<string, unknown>;
  file: UploadedFile | null;
  instanceId: string;
}

export type Handler = (ctx: RequestContext) => Promise<HandlerResult>;

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
}

export interface Route {
  pattern: string[];
  methods: string[];
  roles: RoleSpec;
  handler: Handler;
  /** Multipart routes read a file part instead of a JSON body. */
  multipart?: boolean;
}

export const INSTANCE_ID = randomUUID();

export function route(pattern: string): string[] {
  return pattern.split("/").filter((s) => s.length > 0);
}

interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

function matchPattern(pattern: string[], segments: string[]): Record<string, string> | null {
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    const s = segments[i]!;
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(s);
    } else if (p !== s) {
      return null;
    }
  }
  return params;
}

/** Match the path and method together, so several routes may share a path. */
function matchRoute(segments: string[], routes: Route[], method: string): RouteMatch | null {
  let pathMatched = false;
  for (const r of routes) {
    const params = matchPattern(r.pattern, segments);
    if (params === null) continue;
    pathMatched = true;
    if (r.methods.includes(method)) {
      return { route: r, params };
    }
  }
  if (pathMatched) {
    throw errors.methodNotAllowed();
  }
  return null;
}

const STATE_CHANGING = new Set(["POST", "PATCH", "DELETE", "PUT"]);

export async function authenticate(
  pool: Pool,
  config: Config,
  cookies: string | undefined,
): Promise<Member | null> {
  const token = readSessionCookie(cookies);
  if (token === null) return null;
  const result = await pool.query<{
    member_id: string;
    workspace_id: string;
    name: string;
    email: string;
    role: Role;
  }>(
    `SELECT s.token, m.id AS member_id, m.workspace_id, m.name, m.email, m.role
     FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token = $1 AND s.last_seen_at > now() - ($2 || ' seconds')::interval`,
    [token, String(config.sessionIdleSeconds)],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  await pool.query("UPDATE sessions SET last_seen_at = now() WHERE token = $1", [token]);
  return {
    id: row.member_id,
    workspaceId: row.workspace_id,
    name: row.name,
    email: row.email,
    role: row.role,
  };
}

export function readSessionCookie(cookies: string | undefined): string | null {
  if (cookies === undefined) return null;
  for (const part of cookies.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === "ed_session") {
      const value = part.slice(eq + 1).trim();
      return value.length === 0 ? null : value;
    }
  }
  return null;
}

export function serializeSessionCookie(token: string): string {
  return `ed_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return "ed_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

/**
 * True when a state-changing request's Origin header differs from the origin
 * the client used to reach this app (DP-38).
 */
export function isCrossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  const host = req.headers.host;
  if (host === undefined) return false;
  return origin.replace(/\/$/, "") !== `http://${host}`.replace(/\/$/, "");
}

export interface DispatchOutcome {
  status: number;
  body: unknown;
  headers: Record<string, string | string[]>;
}

/**
 * Dispatch an /api request with the single error precedence (DP-37):
 * 405 method, body size and content type (413, 415), 401 unauthenticated,
 * 404 unknown path, 403 cross-origin and role, then the handler's own
 * idempotent replay, state conflicts, 422 validation and 503 storage errors.
 */
export async function dispatchApi(
  req: IncomingMessage,
  res: ServerResponse,
  rawUrl: string,
  config: Config,
  pool: Pool,
  routes: Route[],
): Promise<DispatchOutcome> {
  const url = new URL(rawUrl, `http://${req.headers.host ?? "localhost"}`);
  const segments = url.pathname.split("/").filter((s) => s.length > 0).slice(1);
  const method = req.method ?? "GET";
  const match = matchRoute(segments, routes, method);

  // 2. Body size and content type. A write with no body is an empty object.
  const contentType = req.headers["content-type"] ?? null;
  const contentLength = req.headers["content-length"];
  const chunked = (req.headers["transfer-encoding"] ?? "").includes("chunked");
  const hasBody =
    (contentLength !== undefined && Number.parseInt(contentLength, 10) > 0) || chunked;

  let body: Record<string, unknown> = {};
  let file: UploadedFile | null = null;
  if (STATE_CHANGING.has(method)) {
    const multipartRoute = match?.route.multipart === true;
    const limit = multipartRoute ? 11_000_000 : MAX_JSON_BYTES;
    if (hasBody) {
      const { bytes, tooLarge } = await readBody(req, limit);
      if (tooLarge) throw errors.payloadTooLarge();
      if (multipartRoute) {
        if (contentType === null || !/^multipart\/form-data/i.test(contentType)) {
          throw errors.unsupportedMediaType();
        }
        const parts = parseMultipart(bytes, contentType);
        for (const part of parts) {
          if (part.name === "file" && part.filename !== null) {
            file = { filename: part.filename, contentType: part.contentType, bytes: part.bytes };
          } else if (part.name === "file") {
            // A file part with no filename cannot be judged.
            file = { filename: "", contentType: part.contentType, bytes: part.bytes };
          }
        }
      } else {
        if (
          contentType === null ||
          contentType.toLowerCase().split(";")[0]?.trim() !== "application/json"
        ) {
          throw errors.unsupportedMediaType();
        }
        const text = bytes.toString("utf-8");
        if (text.trim().length > 0) {
          try {
            const parsed = JSON.parse(text) as unknown;
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw errors.validationFailed({});
            }
            body = parsed as Record<string, unknown>;
          } catch (err) {
            if (err instanceof Error && err.name === "ApiError") throw err;
            throw errors.validationFailed({});
          }
        }
      }
    } else if (multipartRoute) {
      // A multipart write with no body carries no file.
      file = null;
    } else if (contentType !== null && contentType.toLowerCase().split(";")[0]?.trim() !== "application/json") {
      // A write with no body never gets 415.
      body = {};
    }
  }

  // 3. Authentication.
  const member =
    match !== null && match.route.roles === "public"
      ? null
      : await authenticate(pool, config, req.headers.cookie);
  if (match !== null && match.route.roles !== "public" && member === null) {
    throw errors.unauthenticated();
  }

  // 4. An unknown path is 404 after authentication.
  if (match === null) throw errors.notFound();

  const ctx: RequestContext = {
    req,
    res,
    config,
    pool,
    method,
    path: url.pathname,
    query: url.searchParams,
    params: match.params,
    member,
    body,
    file,
    instanceId: INSTANCE_ID,
  };

  // 5. Cross-origin, then role.
  if (STATE_CHANGING.has(method) && isCrossOrigin(req)) {
    throw errors.crossOrigin();
  }
  if (match.route.roles !== "public" && match.route.roles !== "any") {
    const role = member?.role;
    if (role === undefined || !match.route.roles.includes(role)) {
      throw errors.forbidden();
    }
  }

  const result = await match.route.handler(ctx);
  return {
    status: result.status,
    body: result.body,
    headers: result.headers ?? { "Content-Type": JSON_CONTENT_TYPE, "Cache-Control": "no-store" },
  };
}
