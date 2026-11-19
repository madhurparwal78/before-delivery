// HTTP plumbing: the server boundary, routing and the one error shape.
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, notFound, unauthenticated, validationFailed } from "./errors.js";
import { isRecord } from "./json.js";
import type { SessionUser } from "./auth.js";
import { findSession } from "./auth.js";

const BODY_LIMIT_BYTES = 65536;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface Reply {
  status: number;
  /** JSON-serialisable body, unless `text` is given. */
  json?: unknown;
  text?: string;
  contentType?: string;
  headers?: Record<string, string>;
  buffer?: Buffer;
}

interface PublicCtx {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  now: Date;
  /** The parsed JSON body when it is an object; null when there is no body or it is not an object. */
  looseBody(): Record<string, unknown> | null;
  /** The JSON body, or a validation error when it is missing or not an object. */
  body(): Record<string, unknown>;
  header(name: string): string | undefined;
}

interface Ctx extends PublicCtx {
  user: SessionUser;
}

type Route =
  | { method: string; parts: string[]; kind: "signedIn"; handler: (ctx: Ctx) => Promise<Reply> }
  | { method: string; parts: string[]; kind: "anyone"; handler: (ctx: PublicCtx) => Promise<Reply> };

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: (ctx: Ctx) => Promise<Reply>): void {
  routes.push({ method, parts: pattern.split("/").filter(Boolean), kind: "signedIn", handler });
}

export function publicRoute(method: string, pattern: string, handler: (ctx: PublicCtx) => Promise<Reply>): void {
  routes.push({ method, parts: pattern.split("/").filter(Boolean), kind: "anyone", handler });
}

function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const segments = path.split("/").filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let fits = true;
    candidate.parts.forEach((part, index) => {
      const segment = segments[index] ?? "";
      if (part.startsWith(":")) {
        try {
          params[part.slice(1)] = decodeURIComponent(segment);
        } catch {
          fits = false;
        }
      } else if (part !== segment) fits = false;
    });
    if (fits) return { route: candidate, params };
  }
  return null;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > BODY_LIMIT_BYTES) {
    req.resume();
    throw new ApiError(413, "payload_too_large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += piece.length;
    if (size > BODY_LIMIT_BYTES) {
      req.resume();
      throw new ApiError(413, "payload_too_large");
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function isJsonContentType(value: string | undefined): boolean {
  return value !== undefined && /^application\/json\s*(;|$)/i.test(value);
}

function parseBody(raw: Buffer): { value: Record<string, unknown> | null; present: boolean } {
  if (raw.length === 0) return { value: null, present: false };
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    return { value: isRecord(parsed) ? parsed : null, present: true };
  } catch {
    return { value: null, present: true };
  }
}

export function sendReply(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "cache-control": "no-store", "x-content-type-options": "nosniff", ...reply.headers };
  let payload: Buffer | string;
  if (reply.buffer) {
    payload = reply.buffer;
    headers["content-type"] = reply.contentType ?? "application/octet-stream";
  } else if (reply.text !== undefined) {
    payload = reply.text;
    headers["content-type"] = reply.contentType ?? "text/plain; charset=utf-8";
  } else {
    payload = JSON.stringify(reply.json);
    headers["content-type"] = reply.contentType ?? "application/json; charset=utf-8";
  }
  headers["content-length"] = String(Buffer.byteLength(payload));
  res.writeHead(reply.status, headers);
  res.end(payload);
}

function errorReply(error: ApiError, headers?: Record<string, string>): Reply {
  return { status: error.status, json: error.body, headers };
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, ready: boolean): Promise<void> {
  try {
    const method = req.method ?? "GET";
    if (WRITE_METHODS.has(method) && !sameOrigin(req)) throw new ApiError(403, "cross_origin");
    let raw: Buffer = Buffer.alloc(0);
    if (WRITE_METHODS.has(method)) {
      raw = await readBody(req);
      if (raw.length > 0 && !isJsonContentType(req.headers["content-type"])) throw new ApiError(415, "unsupported_media_type");
    }
    if (!ready) {
      sendReply(res, { status: 503, json: url.pathname === "/api/health" ? { status: "starting" } : { code: "starting" } });
      return;
    }
    const found = match(method, url.pathname);
    if (!found) throw notFound();
    const parsed = parseBody(raw);
    const base: PublicCtx = {
      req, url, params: found.params, now: new Date(),
      looseBody: () => parsed.value,
      body: () => {
        if (parsed.value === null) throw validationFailed({ body: "A JSON object is required." });
        return parsed.value;
      },
      header: (name) => {
        const value = req.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
      },
    };
    const chosen = found.route;
    if (chosen.kind === "anyone") {
      sendReply(res, await chosen.handler(base));
      return;
    }
    const user = await findSession(req.headers.cookie);
    if (!user) throw unauthenticated();
    sendReply(res, await chosen.handler({ ...base, user }));
  } catch (error) {
    if (error instanceof ApiError) {
      sendReply(res, errorReply(error, error.body.code === "too_many_attempts" ? { "retry-after": String(error.body.retry_after) } : undefined));
      return;
    }
    console.error(error);
    sendReply(res, { status: 500, json: { code: "internal_error" } });
  }
}
