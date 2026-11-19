import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { JSON_BODY_LIMIT } from "../shared/limits";
import { config } from "./config";
import { requirePrincipal } from "./auth";
import { databaseReady, isConnectionError } from "./db";
import { ApiError } from "./errors";
import type { Reply, Request, Route } from "./http-types";

/** Longer than any client's idle gap between requests, so a reused connection is never closed under it. */
const KEEP_ALIVE_MS = 65_000;

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:", "font-src 'self'", "connect-src 'self' blob:", "worker-src 'self' blob:",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; "),
};

/** The path with its percent-escapes decoded; null when they are malformed. */
export function decodePath(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/** `:name` segments capture (decoded); everything else must match exactly. Null when the path does not fit the pattern. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const wanted = pattern.split("/");
  const actual = path.split("/");
  if (wanted.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < wanted.length; i++) {
    const want = wanted[i] ?? "";
    const got = actual[i] ?? "";
    if (want.startsWith(":")) {
      if (got === "") return null;
      const value = decodePath(got);
      if (value === null) return null;
      params[want.slice(1)] = value;
    } else if (want !== got) {
      return null;
    }
  }
  return params;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const pair of header?.split(";") ?? []) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (tooLarge) return;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(new ApiError("too_large"));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function toReply(error: unknown): Reply {
  const failure = error instanceof ApiError ? error
    : isConnectionError(error) ? new ApiError("database_unavailable")
    : null;
  if (!failure) {
    console.error(error);
    return toReply(new ApiError("internal"));
  }
  const retry = failure.detail.retryAfterSeconds;
  return { status: failure.status, body: failure.toBody(), ...(retry !== undefined && { headers: { "Retry-After": String(retry) } }) };
}

export function send(res: ServerResponse, reply: Reply): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (reply.stream) {
    reply.stream(res);
    return;
  }
  const payload = reply.bytes ?? (reply.body === undefined ? undefined : Buffer.from(JSON.stringify(reply.body)));
  const headers: Record<string, string | string[] | number> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  if (payload) headers["Content-Length"] = payload.length;
  res.writeHead(reply.status, headers);
  res.end(payload);
}

function isJson(req: IncomingMessage): boolean {
  return /^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "");
}

function buildRequest(raw: IncomingMessage, url: URL, params: Record<string, string>, body: Buffer, crossOrigin: boolean): Request {
  return {
    query: url.searchParams, param: (name) => params[name] ?? "", headers: raw.headers, ip: raw.socket.remoteAddress ?? "unknown", body, crossOrigin,
    cookie: (name) => readCookie(raw.headers.cookie, name),
    jsonObject() {
      if (!isJson(raw)) throw new ApiError("unsupported_media");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        throw new ApiError("validation");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ApiError("validation");
      return parsed as Record<string, unknown>;
    },
  };
}

/**
 * Runs one API request through the precedence order. The body size comes first. Every later check needs Postgres, so
 * while it is down the answer is 503. An unknown route answers 401 to a caller without a session, otherwise 404. A
 * route then authenticates (401), looks up (404), checks role, origin and state (403, 409) and validates (422).
 */
async function handleApi(raw: IncomingMessage, url: URL, res: ServerResponse, routes: readonly Route[]): Promise<void> {
  const method = raw.method === "HEAD" ? "GET" : raw.method;
  let matched: { route: Route; params: Record<string, string> } | undefined;
  for (const route of routes) {
    const params = route.method === method ? matchPath(route.pattern, url.pathname) : null;
    if (params) {
      matched = { route, params };
      break;
    }
  }
  try {
    const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
    const limit = matched?.route.bodyLimit ?? JSON_BODY_LIMIT;
    if (hasBody && Number(raw.headers["content-length"] ?? 0) > limit) throw new ApiError("too_large");
    const body = hasBody ? await readBody(raw, limit) : Buffer.alloc(0);
    if (!matched?.route.withoutDatabase && !databaseReady()) throw new ApiError("database_unavailable");
    const origin = raw.headers.origin;
    const crossOrigin = method !== "GET" && origin !== undefined && origin !== config.publicOrigin;
    const request = buildRequest(raw, url, matched?.params ?? {}, body, crossOrigin);
    if (!matched) {
      await requirePrincipal(request);
      throw new ApiError("not_found");
    }
    if (matched.route.withoutSession && crossOrigin) throw new ApiError("forbidden");
    send(res, await matched.route.handler(request));
  } catch (error) {
    raw.resume();
    send(res, toReply(error));
  }
}

export function startServer(routes: readonly Route[], serveStatic: (req: IncomingMessage, url: URL, res: ServerResponse) => Promise<void>): Server {
  const server = createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    let url: URL;
    try {
      url = new URL(req.url ?? "/", config.publicUrl);
    } catch {
      send(res, toReply(new ApiError("not_found")));
      return;
    }
    const handled = url.pathname.startsWith("/api/") ? handleApi(req, url, res, routes) : serveStatic(req, url, res);
    handled.catch((error: unknown) => send(res, toReply(error)));
  });
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1000;
  server.listen(config.port, "0.0.0.0");
  return server;
}
