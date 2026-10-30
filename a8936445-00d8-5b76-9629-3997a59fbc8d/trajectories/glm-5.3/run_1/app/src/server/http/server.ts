/**
 * The HTTP boundary: same-origin only, body-size caps, JSON and multipart shapes,
 * the API error precedence, and static serving of the built client with the never-served rules.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Db } from "../db.js";
import { ApiError, ProviderError, err } from "./errors.js";

const JSON_BODY_LIMIT = 65_536;
const UPLOAD_BODY_LIMIT = 5_100_000;
const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../client");
const STORED_STATUSES = new Set([200, 201, 409, 410, 422]);

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  rawBody: Buffer | null;
  cookies: Record<string, string>;
  userId: string | null;
  params: Record<string, string>;
}

export interface MultipartForm {
  fields: Record<string, string>;
  file: { fileName: string; contentType: string; bytes: Buffer } | null;
}

export interface RouteContext {
  ctx: RequestContext;
  db: Db;
}

export type HandlerResult =
  | { status: number; body: string }
  | { status: number; body: Buffer; contentType: string; disposition?: string };

export type Handler = (rc: RouteContext) => Promise<HandlerResult>;

interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pattern: RegExp;
  paramNames: string[];
  /** Characters of literal path in the spec; longer wins when several patterns match. */
  literalScore: number;
  handler: Handler;
  roles: "public" | "signed_in";
  readOnly: boolean;
}

export class App {
  private routes: Route[] = [];
  private readonly inFlight = new Map<string, Promise<HandlerResult>>();

  constructor(readonly db: Db) {}

  route(
    method: Route["method"],
    pathSpec: string,
    roles: "public" | "signed_in",
    handler: Handler,
    readOnly = false
  ): void {
    const paramNames: string[] = [];
    const source = pathSpec.replace(/:[A-Za-z_]+/g, (m) => {
      paramNames.push(m.slice(1));
      return "([^/]+)";
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${source}$`),
      paramNames,
      literalScore: source.replaceAll("([^/]+)", "").length,
      handler,
      roles,
      readOnly
    });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await this.dispatch(req, res);
    } catch (e) {
      const apiErr =
        e instanceof ApiError
          ? e
          : e instanceof ProviderError
            ? e.apiError()
            : err(500, "internal", "Something went wrong. Try again in a moment.");
      if (apiErr.status === 500 || e instanceof ProviderError) {
        console.error("request error:", req.method, req.url, e instanceof Error ? e.message : e);
      }
      this.sendJson(res, apiErr.status, apiErr.body());
    }
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const host = req.headers.host ?? "localhost";
    const origin = req.headers.origin;

    // Precedence 1. Cross-origin state-changing requests are refused before everything else.
    if (method !== "GET" && method !== "HEAD" && origin !== undefined && origin !== `http://${host}`) {
      throw err(403, "cross_origin", "Cross-origin requests are refused.");
    }

    const url = new URL(req.url ?? "/", `http://${host}`);

    if (url.pathname === "/api/health" && method === "GET") {
      this.sendJson(res, 200, JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await this.dispatchApi(req, res, method, url);
      return;
    }

    await this.serveStatic(req, res, method, url.pathname);
  }

  private async dispatchApi(req: IncomingMessage, res: ServerResponse, method: string, url: URL): Promise<void> {
    const candidates = this.routes
      .filter((r) => r.pattern.test(url.pathname))
      .sort((a, b) => b.literalScore - a.literalScore);
    if (candidates.length === 0) {
      throw err(404, "not_found", "That record isn't available.");
    }
    const route = candidates.find((r) => r.method === method);
    if (!route) {
      const anyRoute = candidates[0];
      res.setHeader("Allow", anyRoute.readOnly ? "GET" : candidates.map((r) => r.method).join(", "));
      throw err(
        405,
        anyRoute.readOnly ? "read_only" : "method_not_allowed",
        anyRoute.readOnly ? "Inspection links are read-only." : "That method isn't supported here."
      );
    }

    const cookies = parseCookies(req.headers.cookie);
    const rawIdempotencyKey = visibleAscii(req.headers["idempotency-key"]);
    const match = route.pattern.exec(url.pathname);
    const ctx: RequestContext = {
      req,
      res,
      method,
      url,
      rawBody: null,
      cookies,
      userId: null,
      params: {}
    };
    route.paramNames.forEach((name, i) => {
      if (match) ctx.params[name] = decodeURIComponent(match[i + 1]);
    });

    // Precedence 2. A live session for non-public routes.
    const userId = await resolveSession(this.db, cookies["sk_session"] ?? null);
    if (route.roles === "signed_in" && userId === null) {
      throw err(401, "unauthenticated", "Sign in to continue.");
    }
    ctx.userId = userId;

    // Precedence 3. Idempotency-Key replay/conflict and in-flight wait for signed-in users.
    if (rawIdempotencyKey !== null && method !== "GET" && userId !== null) {
      const idempotencyKey = rawIdempotencyKey;
      ctx.rawBody = await readRawBody(req, UPLOAD_BODY_LIMIT, "file_too_large");
      const requestText = ctx.rawBody.toString("utf8");
      const stored = await this.lookupStoredResponse(userId, method, url.pathname, idempotencyKey, requestText);
      if (stored.kind === "replay") {
        this.sendJson(res, stored.status, stored.body);
        return;
      }
      if (stored.kind === "conflict") {
        throw err(
          409,
          "idempotency_conflict",
          "This request was already sent with different details. Reload and try again."
        );
      }
      const cacheKey = `${userId}\n${method}\n${url.pathname}\n${idempotencyKey}`;
      const existing = this.inFlight.get(cacheKey);
      if (existing) {
        const awaited = await existing;
        await this.emit(res, awaited);
        return;
      }
      const promise = (async () => {
        const result = await route.handler({ ctx, db: this.db });
        if (typeof result.body === "string" && STORED_STATUSES.has(result.status)) {
          await this.db.query(
            `INSERT INTO stored_responses (user_id, method, path, key, request_hash, status, body, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7, now())
             ON CONFLICT (user_id, method, path, key) DO NOTHING`,
            [userId, method, url.pathname, idempotencyKey, hashBody(requestText), result.status, result.body]
          );
        }
        return result;
      })();
      this.inFlight.set(cacheKey, promise);
      try {
        const result = await promise;
        await this.emit(res, result);
      } finally {
        this.inFlight.delete(cacheKey);
      }
      return;
    }

    const result = await route.handler({ ctx, db: this.db });
    await this.emit(res, result);
  }

  private async emit(res: ServerResponse, result: HandlerResult): Promise<void> {
    if (typeof result.body === "string") {
      this.sendJson(res, result.status, result.body);
      return;
    }
    if ("contentType" in result) {
      res.writeHead(result.status, {
        "Content-Type": result.contentType,
        ...(result.disposition ? { "Content-Disposition": result.disposition } : {})
      });
      res.end(result.body);
    }
  }

  private async lookupStoredResponse(
    userId: string,
    method: string,
    pathName: string,
    key: string,
    requestBody: string
  ): Promise<{ kind: "replay"; status: number; body: string } | { kind: "conflict" } | { kind: "miss" }> {
    const rows = await this.db.query<{ request_hash: string; status: number; body: string }>(
      "SELECT request_hash, status, body FROM stored_responses WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4",
      [userId, method, pathName, key]
    );
    if (rows.length === 0) return { kind: "miss" };
    if (rows[0].request_hash !== hashBody(requestBody)) return { kind: "conflict" };
    return { kind: "replay", status: rows[0].status, body: rows[0].body };
  }

  private sendJson(res: ServerResponse, status: number, body: string): void {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(body);
  }

  /** Static client with the never-served rules. */
  private async serveStatic(req: IncomingMessage, res: ServerResponse, method: string, pathname: string): Promise<void> {
    if (method !== "GET" && method !== "HEAD") {
      throw err(404, "not_found", "That record isn't available.");
    }
    if (isNeverServed(pathname)) {
      throw err(404, "not_found", "That record isn't available.");
    }
    const decoded = decodeURIComponent(pathname);
    let filePath = decoded === "/" ? "/index.html" : decoded;
    filePath = path.posix.normalize(filePath);
    let absolute = path.join(CLIENT_DIR, filePath);
    if (!absolute.startsWith(CLIENT_DIR + path.sep)) {
      throw err(404, "not_found", "That record isn't available.");
    }
    try {
      const s = await stat(absolute);
      if (s.isDirectory()) absolute = path.join(absolute, "index.html");
      const data = await readFile(absolute);
      res.writeHead(200, { "Content-Type": contentTypeOf(absolute), "Cache-Control": "no-cache" });
      res.end(data);
    } catch {
      // SPA fallback for app routes without a file extension.
      if (!path.posix.extname(decoded)) {
        const data = await readFile(path.join(CLIENT_DIR, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(data);
        return;
      }
      throw err(404, "not_found", "That record isn't available.");
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

async function resolveSession(db: Db, token: string | null): Promise<string | null> {
  if (token === null || token === "") return null;
  const rows = await db.query<{ user_id: string; status: string | null }>(
    `SELECT s.user_id, t.status FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashBody(token)]
  );
  if (rows.length === 0) return null;
  if (rows[0].status === "offboarded") return null;
  return rows[0].user_id;
}

const hashBody = (s: string): string => createHash("sha256").update(s).digest("hex");

export function visibleAscii(value: string | string[] | undefined): string | null {
  const single = Array.isArray(value) ? value[0] : value;
  if (single === undefined) return null;
  if (single.length < 1 || single.length > 100) return null;
  for (const ch of single) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) return null;
  }
  return single;
}

/** Read the whole raw body up to a limit; over the limit → 413 with the given code. */
export function readRawBody(
  req: IncomingMessage,
  limit: number,
  tooLargeCode: "body_too_large" | "file_too_large"
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(err(413, tooLargeCode, "That request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on("error", (e) => {
      if (!settled) reject(e);
    });
  });
}

/** The request body as UTF-8, honouring an earlier read and the size cap. */
export async function readBodyUtf8(
  ctx: RequestContext,
  limit: number,
  code: "body_too_large" | "file_too_large"
): Promise<string> {
  if (ctx.rawBody !== null) {
    if (ctx.rawBody.length > limit) {
      throw err(413, code, "That request is too large.");
    }
    return ctx.rawBody.toString("utf8");
  }
  const raw = await readRawBody(ctx.req, limit, code);
  ctx.rawBody = raw;
  return raw.toString("utf8");
}

export const jsonBodyLimit = JSON_BODY_LIMIT;
export const uploadBodyLimit = UPLOAD_BODY_LIMIT;

/** Parse multipart/form-data for the upload route. */
export function parseMultipart(body: Buffer, contentType: string | undefined): MultipartForm {
  const match = /boundary="?([^";]+)"?/i.exec(contentType ?? "");
  if (!match) {
    throw err(415, "unsupported_media_type", "That kind of content isn't accepted.");
  }
  const boundary = Buffer.from(`--${match[1]}`);
  const form: MultipartForm = { fields: {}, file: null };
  let idx = body.indexOf(boundary);
  while (idx !== -1) {
    const start = idx + boundary.length;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    const part = body.slice(start, next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString("utf8");
      const data = part.slice(headerEnd + 4, part.length - 2);
      const nameMatch = /name="([^"]*)"/i.exec(headerText);
      const fileMatch = /filename="([^"]*)"/i.exec(headerText);
      const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerText);
      if (nameMatch) {
        if (fileMatch) {
          form.file = {
            fileName: fileMatch[1],
            contentType: (typeMatch?.[1] ?? "application/octet-stream").trim(),
            bytes: data
          };
        } else {
          form.fields[nameMatch[1]] = data.toString("utf8");
        }
      }
    }
    idx = next;
  }
  return form;
}

function isNeverServed(pathname: string): boolean {
  const base = path.posix.basename(pathname);
  if (base.startsWith(".")) return true;
  if (["run.json", "package-lock.json", "package.json", "tsconfig.json"].includes(base)) return true;
  if (base.startsWith(".env") || base.endsWith(".env")) return true;
  if (base.endsWith(".ts") || base.endsWith(".map") || base.endsWith(".sql")) return true;
  if (pathname.includes("..")) return true;
  return false;
}

function contentTypeOf(filePath: string): string {
  const ext = path.extname(filePath);
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

export function listen(app: App, port: number): void {
  const server = createServer((req, res) => {
    void app.handle(req, res);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Stationkeeper listening on 0.0.0.0:${port}`);
  });
}
