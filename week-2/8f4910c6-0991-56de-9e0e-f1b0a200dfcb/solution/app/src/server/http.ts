// Routing and the start of the one error precedence. The router answers steps 1–3 (route and method,
// rate limit, session); each handler then runs steps 4–9 in order with the helpers below:
// record (404/410) → role (403) → body size (413) → media type (415) → JSON (400) → idempotency key (400)
// → replay → 409/412 → 422, and a dependency outage (503) only after all of them.

import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "./errors.js";
import { authenticate, type Member, type Role } from "./auth.js";
import { checkRateLimit, type RateBucket } from "./rate-limit.js";
import { beginIdempotent } from "./idempotency.js";

const JSON_LIMIT = 1_000_000;
const MULTIPART_ALLOWANCE = 100_000;

export interface UploadedFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
}

export class Ctx {
  readonly now = Date.now();
  readonly query: URLSearchParams;
  readonly ip: string;

  constructor(
    readonly req: IncomingMessage,
    readonly url: URL,
    readonly params: Record<string, string>,
  ) {
    this.query = url.searchParams;
    this.ip = clientAddress(req);
  }

  header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  /** Steps 6: size, media type and JSON syntax. */
  async json(): Promise<unknown> {
    const raw = await readBody(this.req, JSON_LIMIT);
    if (raw === null) throw new ApiError(413, "too_large", { limitBytes: JSON_LIMIT });
    if (mediaType(this.req) !== "application/json") throw new ApiError(415, "unsupported_media_type");
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      throw new ApiError(400, "bad_json");
    }
  }

  /** Step 6 for uploads: the request may be the file limit plus 100,000 bytes, the `file` part the limit. */
  async upload(limit: number): Promise<UploadedFile | null> {
    const total = limit + MULTIPART_ALLOWANCE;
    const raw = await readBody(this.req, total);
    if (raw === null) throw new ApiError(413, "too_large", { limitBytes: total });
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(this.header("content-type") ?? "");
    if (mediaType(this.req) !== "multipart/form-data" || !boundary) {
      throw new ApiError(415, "unsupported_media_type");
    }
    const file = multipartFile(raw, (boundary[1] ?? boundary[2]).trim());
    if (file && file.data.length > limit) throw new ApiError(413, "too_large", { limitBytes: limit });
    return file;
  }

  /** Steps 6–7 for idempotent writes: the key is required; a stored success replays as it was. */
  async idempotent(scope: string, body: unknown, effect: () => Promise<Reply>): Promise<Reply> {
    const key = this.header("idempotency-key");
    if (!key) throw new ApiError(400, "idempotency_key_required");
    const begun = await beginIdempotent(scope, key, `${this.req.method} ${this.url.pathname}`, body);
    if (begun.kind === "replay") {
      return { status: begun.status, raw: begun.body, contentType: "application/json; charset=utf-8",
        headers: { "Idempotent-Replayed": "true" } };
    }
    let reply: Reply;
    try {
      reply = await effect();
    } catch (error) {
      await begun.slot.abandon();
      throw error;
    }
    if (reply.status < 300) await begun.slot.complete(reply.status, JSON.stringify(reply.body));
    else await begun.slot.abandon();
    return reply;
  }
}

export class MemberCtx extends Ctx {
  constructor(base: Ctx, readonly member: Member) {
    super(base.req, base.url, base.params);
  }

  /** Step 5. */
  allow(...roles: Role[]): void {
    if (!roles.includes(this.member.role)) throw new ApiError(403, "forbidden");
  }

  isTalent(): boolean {
    return this.member.role === "talent";
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Entry {
  method: Method;
  pattern: RegExp;
  keys: string[];
  execute: (ctx: Ctx) => Promise<Reply>;
}

const entries: Entry[] = [];

function register(method: Method, path: string, execute: (ctx: Ctx) => Promise<Reply>): void {
  const keys: string[] = [];
  const source = path.replace(/[.]/g, "\\.").replace(/:(\w+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  entries.push({ method, pattern: new RegExp(`^${source}$`), keys, execute });
}

export interface RouteOptions {
  rateLimit?: RateBucket;
}

/** A route anyone may call. */
export function publicRoute(method: Method, path: string, handle: (ctx: Ctx) => Promise<Reply>,
  options: RouteOptions = {}): void {
  register(method, path, async (ctx) => {
    if (options.rateLimit) await checkRateLimit(options.rateLimit, ctx.ip, ctx.now);
    return handle(ctx);
  });
}

/** A route that needs a live session (step 3). */
export function memberRoute(method: Method, path: string, handle: (ctx: MemberCtx) => Promise<Reply>): void {
  register(method, path, async (ctx) => handle(new MemberCtx(ctx, await authenticate(ctx.req, ctx.now))));
}

export function json(status: number, body?: unknown, headers: Record<string, string> = {}): Reply {
  return { status, body, headers };
}

/** The one error shape as a reply; every error body leaves through here. */
export function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) return { status: error.status, body: error.body(), headers: error.headers };
  return errorReply(new ApiError(500, "internal_error"));
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.raw !== undefined) {
    headers["Content-Type"] = reply.contentType ?? "application/octet-stream";
    res.writeHead(reply.status, headers);
    res.end(reply.raw);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  headers["Content-Type"] = "application/json; charset=utf-8";
  res.writeHead(reply.status, headers);
  res.end(JSON.stringify(reply.body));
}

function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

/** Reads the whole body; past `limit` it keeps draining so the client still reads the 413. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  return size > limit ? null : Buffer.concat(chunks);
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
}

/** The part named `file` of a multipart/form-data body, or null when there is none. */
function multipartFile(body: Buffer, boundary: string): UploadedFile | null {
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const headerStart = start + delimiter.length + 2;
    const next = body.indexOf(delimiter, headerStart);
    if (next === -1) return null;
    const headerEnd = body.indexOf("\r\n\r\n", headerStart);
    if (headerEnd !== -1 && headerEnd < next) {
      const headers = body.subarray(headerStart, headerEnd).toString("utf8");
      if (/name="file"/i.test(headers)) {
        return {
          filename: /filename="([^"]*)"/i.exec(headers)?.[1] ?? "",
          contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "",
          data: body.subarray(headerEnd + 4, next - 2),
        };
      }
    }
    start = next;
  }
  return null;
}

/** Answers a path the app owns as an API path; false when no route pattern matches. */
export async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const matching = entries.filter((entry) => entry.pattern.test(url.pathname));
  if (!matching.length) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const entry = matching.find((candidate) => candidate.method === method);
  let reply: Reply;
  try {
    if (!entry) {
      const allow = [...new Set(matching.map((candidate) => candidate.method))].join(", ");
      throw new ApiError(405, "method_not_allowed", {}, { Allow: allow });
    }
    const values = entry.pattern.exec(url.pathname)?.slice(1) ?? [];
    let params: Record<string, string>;
    try {
      params = Object.fromEntries(entry.keys.map((key, i) => [key, decodeURIComponent(values[i])]));
    } catch {
      throw new ApiError(404, "not_found");
    }
    reply = await entry.execute(new Ctx(req, url, params));
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(`${method} ${url.pathname} failed:`, error);
    reply = errorReply(error);
  }
  if (!req.readableEnded) {
    req.resume();
    await new Promise((resolve) => {
      req.once("end", resolve);
      req.once("close", resolve);
    });
  }
  send(res, reply);
  return true;
}
