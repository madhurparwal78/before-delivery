// The HTTP boundary: one error shape, the precedence order of the request checks, body limits,
// and the static client.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { crewByHandle, FIELD_MESSAGES } from "../shared/catalog.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const invalid = (fields: Record<string, string>): ApiError =>
  new ApiError(422, "validation_failed", "Check the highlighted fields.", { fields });

export const notFound = (what = "That resource"): ApiError => new ApiError(404, "not_found", `${what} was not found.`);

export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export const errorReply = (error: ApiError): Reply => ({
  status: error.status,
  body: { error: { code: error.code, message: error.message, ...error.extra } },
});

export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  json: Record<string, unknown>;
  raw: Buffer;
  params: string[];
  actor: string;
  // Field errors every write can carry: the acting crew member and the idempotency key.
  headerErrors: Record<string, string>;
  idempotencyKey: string | null;
}

type Handler = (req: ApiRequest) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  multipart?: boolean;
}

const routes: Route[] = [];

export const route = (method: string, path: string, handler: Handler, multipart = false): void => {
  const pattern = new RegExp(`^${path.replace(/:[a-z]+/g, "([^/]+)")}$`);
  routes.push({ method, pattern, handler, multipart });
};

const streams = new Map<string, (res: ServerResponse) => void>();

export const stream = (path: string, open: (res: ServerResponse) => void): void => {
  streams.set(path, open);
};

const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 10_100_000;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const KEY_PATTERN = /^[\x21-\x7e]{1,100}$/;

const send = (res: ServerResponse, reply: Reply): void => {
  const payload = Buffer.from(JSON.stringify(reply.body));
  res.writeHead(reply.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...reply.headers,
  });
  res.end(payload);
};

// A client that hangs up before its body arrives gets nothing back and nothing is stored.
class ClientGone extends Error {}

const readBody = (req: IncomingMessage, limit: number): Promise<Buffer | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
    req.on("aborted", () => reject(new ClientGone()));
  });

const sameOrigin = (req: IncomingMessage): boolean => {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host ?? "";
  return origin === `http://${host}` || origin === `https://${host}`;
};

const handleApi = async (req: IncomingMessage, res: ServerResponse, pathname: string, query: URLSearchParams): Promise<void> => {
  const method = req.method ?? "GET";
  const write = WRITES.has(method);
  const open = streams.get(pathname);
  if (open && method === "GET") return open(res);
  const found = routes.find((r) => r.method === method && r.pattern.test(pathname));
  if (write && !sameOrigin(req)) {
    req.resume();
    return send(res, errorReply(new ApiError(403, "cross_origin", "Writes must come from this app's own origin.")));
  }
  let raw = Buffer.alloc(0);
  let json: Record<string, unknown> = {};
  if (write) {
    const body = await readBody(req, found?.multipart ? MULTIPART_LIMIT : JSON_LIMIT);
    if (body === null) return send(res, errorReply(new ApiError(413, "payload_too_large", "The request body is too large.")));
    raw = body;
    if (method !== "DELETE") {
      const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const wanted = found?.multipart ? "multipart/form-data" : "application/json";
      if (type !== wanted) {
        return send(res, errorReply(new ApiError(415, "unsupported_media_type", `Send ${wanted}.`)));
      }
      if (!found?.multipart) {
        try {
          const parsed: unknown = JSON.parse(raw.toString("utf8"));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
          json = parsed as Record<string, unknown>;
        } catch {
          return send(res, errorReply(new ApiError(400, "malformed_json", "The body is not a JSON object.")));
        }
      }
    }
  } else {
    req.resume();
  }
  if (!found) return send(res, errorReply(notFound("That API path")));
  const headerErrors: Record<string, string> = {};
  const crew = req.headers["x-crew-member"];
  const actor = typeof crew === "string" ? crew : "maya";
  if (typeof crew === "string" && !crewByHandle(crew)) headerErrors["X-Crew-Member"] = FIELD_MESSAGES.crew;
  const key = req.headers["idempotency-key"];
  let idempotencyKey: string | null = null;
  if (typeof key === "string") {
    if (KEY_PATTERN.test(key)) idempotencyKey = key;
    else headerErrors["Idempotency-Key"] = FIELD_MESSAGES.idempotencyKey;
  }
  let params: string[];
  try {
    params = (found.pattern.exec(pathname) ?? []).slice(1).map(decodeURIComponent);
  } catch {
    return send(res, errorReply(notFound("That API path")));
  }
  const reply = await found.handler({
    method,
    path: pathname,
    query,
    headers: req.headers,
    json,
    raw,
    params,
    actor,
    headerErrors,
    idempotencyKey,
  });
  send(res, reply);
};

// The built client: three screen paths, hashed assets, fonts and the icon. Nothing else.
const CLIENT_ROOT = fileURLToPath(new URL("../../client/", import.meta.url));
const SCREENS = new Set(["/tasks", "/triage", "/requests"]);
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const sendIndex = (res: ServerResponse, status: number): void => {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
  createReadStream(join(CLIENT_ROOT, "index.html")).pipe(res);
};

const handleStatic = async (res: ServerResponse, path: string): Promise<void> => {
  if (path === "/") {
    res.writeHead(302, { Location: "/tasks" });
    return void res.end();
  }
  if (SCREENS.has(path)) return sendIndex(res, 200);
  const served = /^\/(assets\/[\w.-]+\.(js|css|woff2|svg)|fonts\/[\w.-]+\.woff2|favicon\.svg)$/.exec(path);
  if (served) {
    const file = normalize(join(CLIENT_ROOT, served[1]));
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) {
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)],
        "Content-Length": info.size,
        "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      });
      return void createReadStream(file).pipe(res);
    }
  }
  sendIndex(res, 404);
};

export const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const [pathname, search = ""] = (req.url ?? "/").split("?", 2);
  try {
    if (pathname === "/api" || pathname.startsWith("/api/")) await handleApi(req, res, pathname, new URLSearchParams(search));
    else await handleStatic(res, pathname);
  } catch (error) {
    if (error instanceof ApiError) return send(res, errorReply(error));
    if (error instanceof ClientGone) return void res.destroy();
    console.error(error);
    if (!res.headersSent) send(res, errorReply(new ApiError(500, "internal_error", "Something went wrong on the server.")));
    else res.destroy();
  }
};
