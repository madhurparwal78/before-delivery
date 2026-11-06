// The API pipeline: one order of checks for every endpoint (brief: Error precedence, Server boundary).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { App } from "../app.js";
import { ApiError, notFound, sendError, unauthenticated } from "./errors.js";
import { withIdempotency } from "./idempotency.js";
import { type AccountRow, sessionAccount } from "./session.js";

const BODY_LIMIT = 65_536;

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  params: string[];
  raw: Buffer;
  body: Record<string, unknown>;
  /** The account whose session sent this request; passed along, never stored anywhere shared. */
  account: AccountRow | null;
  /** Business time at the instant the request arrived. */
  now: number;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Route {
  method: "GET" | "POST" | "DELETE";
  pattern: RegExp;
  auth?: boolean;
  idempotent?: boolean;
  handle(ctx: Ctx, app: App): Promise<Reply>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > BODY_LIMIT) return reject(new ApiError(413, "too_large", "The request body is larger than 65,536 bytes."));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        req.removeAllListeners("data");
        reject(new ApiError(413, "too_large", "The request body is larger than 65,536 bytes."));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isJsonType(header: string | undefined): boolean {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";
}

function parseJson(raw: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw.toString("utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // falls through to the bad_json answer
  }
  throw new ApiError(400, "bad_json", "The request body is not a JSON object.");
}

const IDEMPOTENCY_KEY = /^[\x20-\x7e]{1,100}$/;

function sameOrigin(req: IncomingMessage, publicUrl: string | undefined): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const own = [`http://${req.headers.host}`, publicUrl ? new URL(publicUrl).origin : ""];
  return own.includes(origin);
}

function sendJson(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.body === undefined || Buffer.isBuffer(reply.body)) {
    res.writeHead(reply.status, headers);
    res.end(reply.body);
    return;
  }
  const payload = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
  res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(payload);
}

export async function handleApi(app: App, routes: Route[], req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    const now = app.clock.now();
    const method = req.method ?? "GET";
    const raw = await readBody(req);
    let body: Record<string, unknown> = {};
    if (method === "POST" || raw.length > 0) {
      if (!isJsonType(req.headers["content-type"])) {
        throw new ApiError(415, "unsupported_media_type", "Send the request body as application/json.");
      }
      body = parseJson(raw);
    }
    let params: string[] = [];
    const route = routes.find((r) => {
      const match = r.method === method && r.pattern.exec(url.pathname);
      if (match) params = match.slice(1);
      return Boolean(match);
    });
    if (!route) throw notFound();
    const key = req.headers["idempotency-key"];
    if (route.idempotent && (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key))) {
      throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header of 1 to 100 printable characters.");
    }
    if (method !== "GET" && !sameOrigin(req, app.config.publicUrl)) {
      throw new ApiError(403, "cross_origin", "Requests from other sites are refused.");
    }
    const account = await sessionAccount(app.db, req);
    if (route.auth && !account) throw unauthenticated();
    const ctx: Ctx = { req, url, params, raw, body, account, now };
    const run = (): Promise<Reply> => route.handle(ctx, app);
    const reply =
      route.idempotent && account && typeof key === "string" ? await withIdempotency(app.db, account.id, key, raw, run) : await run();
    sendJson(res, reply);
  } catch (error) {
    sendError(res, error);
  }
}
