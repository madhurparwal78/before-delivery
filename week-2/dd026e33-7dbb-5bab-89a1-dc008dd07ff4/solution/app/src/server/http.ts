// The HTTP pipeline (brief: API › Precedence, Server boundary). Checks run in the published order:
// size and content type, origin, session, idempotent replay; each handler then checks 404, role,
// state conflict, version, validation and provider failure in that order. Every error is written by
// writeError.
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { resolveSession, type SessionUser } from "./auth.js";
import { config } from "./config.js";
import { pool, transaction, type Db } from "./db.js";
import { ApiError, forbidden, notFound, payloadTooLarge, unsupportedMediaType } from "./errors.js";
import { claimKey, storeReply, type IdempotencyScope } from "./idempotency.js";

const JSON_LIMIT = 100_000;
const UPLOAD_LIMIT = 10_000_000;

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  file?: { contentType: string; data: Buffer };
}

export interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
  user: SessionUser;
  body: unknown;
  db: Db;
  idempotencyKey: string | null;
  /** Reads the rest of an upload body; rejects with 413 past the limit, or when the client goes away. */
  readUpload: () => Promise<Buffer>;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Route {
  method: Method;
  pattern: string;
  /** "json": parsed JSON body; "upload": multipart read on demand by the handler; "none": no body. */
  body: "json" | "upload" | "none";
  /** Routes reachable without a session (health, status, sign-in). */
  open?: boolean;
  /** One of the four idempotent submissions. */
  idempotent?: boolean;
  /** The handler manages its own transactions (uploads). */
  ownTransactions?: boolean;
  handler: (ctx: Ctx) => Promise<Reply>;
}

interface CompiledRoute extends Route {
  regex: RegExp;
  names: string[];
}

class ClientGone extends Error {}

const ANONYMOUS: SessionUser = { id: "", name: "", email: "", role: "owner", sessionId: "" };

function compile(routes: Route[]): CompiledRoute[] {
  return routes.map((route) => {
    const names: string[] = [];
    const source = route.pattern.replace(/:([a-z_]+)/g, (_m, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { ...route, regex: new RegExp(`^${source}$`), names };
  });
}

function sendJson(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(status === 204 ? undefined : body);
}

/** The one place an API error is written. */
function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(res, error.status, JSON.stringify(error.payload), error.status === 413 ? { Connection: "close" } : {});
    return;
  }
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  sendJson(res, 500, JSON.stringify({ error: "internal" }));
}

function contentLength(req: IncomingMessage): number | null {
  const header = req.headers["content-length"];
  return header === undefined ? null : Number(header);
}

function hasBody(req: IncomingMessage): boolean {
  const length = contentLength(req);
  return (length !== null && length > 0) || req.headers["transfer-encoding"] !== undefined;
}

/** After a 413 the rest of the body is drained (up to a cap) so the client can read the answer. */
function drain(req: IncomingMessage): void {
  let seen = 0;
  req.on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > UPLOAD_LIMIT * 2) req.destroy();
  });
  req.resume();
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onAbort);
      req.off("close", onClose);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks, size));
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) {
        finish(payloadTooLarge());
        drain(req);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => finish(null);
    const onAbort = (): void => finish(new ClientGone("client went away"));
    const onClose = (): void => {
      if (!req.complete) finish(new ClientGone("client went away"));
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("aborted", onAbort);
    req.on("close", onClose);
  });
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === "") return true;
  const host = req.headers.host;
  return origin === config.publicOrigin || (host !== undefined && (origin === `http://${host}` || origin === `https://${host}`));
}

function idempotencyKeyOf(req: IncomingMessage): string | null {
  const raw = req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  return key !== undefined && key.length >= 1 && key.length <= 100 ? key : null;
}

export function createApiHandler(routes: Route[]): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> {
  const compiled = compile(routes);
  return async (req, res, url) => {
    const method = (req.method ?? "GET").toUpperCase();
    const path = url.pathname;
    let route: CompiledRoute | null = null;
    let params: Record<string, string> = {};
    for (const candidate of compiled) {
      if (candidate.method !== method) continue;
      const match = candidate.regex.exec(path);
      if (!match) continue;
      route = candidate;
      params = Object.fromEntries(candidate.names.map((name, i) => [name, decodeURIComponent(match[i + 1] ?? "")]));
      break;
    }
    try {
      // 1. Size and content type.
      const kind = route?.body ?? (method === "GET" ? "none" : "json");
      const contentType = (req.headers["content-type"] ?? "").toLowerCase();
      const declared = contentLength(req);
      if (kind === "upload") {
        if (declared !== null && declared > UPLOAD_LIMIT) {
          drain(req);
          throw payloadTooLarge();
        }
        if (!contentType.startsWith("multipart/form-data")) throw unsupportedMediaType();
      } else if (hasBody(req)) {
        if (declared !== null && declared > JSON_LIMIT) {
          drain(req);
          throw payloadTooLarge();
        }
        if (!contentType.startsWith("application/json")) throw unsupportedMediaType();
      }
      let body: unknown = undefined;
      if (kind !== "upload" && hasBody(req)) {
        const raw = await readBody(req, JSON_LIMIT);
        try {
          body = raw.length > 0 ? JSON.parse(raw.toString("utf8")) : undefined;
        } catch {
          body = undefined;
        }
      }
      // 2. A state-changing request from another origin.
      if (method !== "GET" && !originAllowed(req)) throw forbidden();
      // 3. Session.
      const user = route?.open ? ANONYMOUS : await resolveSession(req);
      if (!route) throw notFound();
      const found = route;
      const idempotencyKey = idempotencyKeyOf(req);
      const ctxBase = {
        req,
        params,
        query: url.searchParams,
        path,
        user,
        body,
        idempotencyKey,
        readUpload: () => readBody(req, UPLOAD_LIMIT),
      };
      let reply: Reply;
      if (method === "GET" || found.ownTransactions) {
        reply = await found.handler({ ...ctxBase, db: pool });
      } else {
        reply = await transaction(async (client: pg.PoolClient) => {
          // 4. Idempotent replay.
          const scope: IdempotencyScope | null =
            found.idempotent && idempotencyKey ? { userId: user.id, route: `${method} ${path}`, key: idempotencyKey } : null;
          if (scope) {
            const stored = await claimKey(client, scope, body);
            if (stored) return { status: stored.status, body: JSON.parse(stored.body) as unknown, headers: { "X-Idempotent-Replay": "true" } };
          }
          const fresh = await found.handler({ ...ctxBase, db: client });
          if (scope) await storeReply(client, scope, { status: fresh.status, body: JSON.stringify(fresh.body ?? null) });
          return fresh;
        });
      }
      if (reply.file) {
        res.writeHead(reply.status, {
          "Content-Type": reply.file.contentType,
          "Content-Length": String(reply.file.data.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          ...reply.headers,
        });
        res.end(reply.file.data);
        return;
      }
      sendJson(res, reply.status, reply.body === undefined ? "" : JSON.stringify(reply.body), reply.headers);
    } catch (error) {
      if (error instanceof ClientGone) {
        res.destroy();
        return;
      }
      writeError(res, error);
    }
  };
}

// ---- Static browser assets -------------------------------------------------------------------

const CLIENT_ROOT = fileURLToPath(new URL("../../client/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const PAGE_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

/**
 * Serves the built browser assets; any other extension-less path is an app page (index.html), which
 * carries `pageData` (the signed-in user, when there is one) so the first screen renders at once.
 */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pageData: (req: IncomingMessage) => Promise<unknown>,
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 404, JSON.stringify({ error: "not_found" }));
    return;
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  const servable = relative.startsWith(`assets${sep}`) || relative.startsWith(`fonts${sep}`);
  if (servable && !relative.includes("..")) {
    const file = `${CLIENT_ROOT}${relative}`;
    try {
      const info = await stat(file);
      if (info.isFile()) {
        const data = await readFile(file);
        res.writeHead(200, {
          ...PAGE_HEADERS,
          "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
          "Content-Length": String(data.length),
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        res.end(method === "HEAD" ? undefined : data);
        return;
      }
    } catch {
      // fall through to not found
    }
  }
  if (servable || extname(relative) !== "" || relative.split(sep).some((segment) => segment.startsWith("."))) {
    res.writeHead(404, { ...PAGE_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const data = JSON.stringify((await pageData(req)) ?? null).replace(/</g, "\\u003c");
  const index = (await readFile(`${CLIENT_ROOT}index.html`, "utf8")).replace(
    "</head>",
    `<script id="lacquer-session" type="application/json">${data}</script></head>`,
  );
  res.writeHead(200, { ...PAGE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(method === "HEAD" ? undefined : index);
}
