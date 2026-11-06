// Request pipeline: body limits, same-origin rule, credentials, routing and the error answer.
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { HttpError, crossOrigin, internalError, invalid, notFound, payloadTooLarge, readOnlyRoute, unauthenticated } from "./errors.js";
import { authenticate, type Caller } from "./auth.js";

const BODY_LIMIT = 1_000_000;

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Reply => ({ status, json: body, headers });
export const noContent = (headers: Record<string, string> = {}): Reply => ({ status: 204, headers });
export const bytes = (body: Buffer | string, contentType: string, headers: Record<string, string> = {}): Reply =>
  ({ status: 200, body, contentType, headers });

export interface Context {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage["headers"];
  raw: Buffer;
  res: ServerResponse;
  body(): unknown;
}

export interface AuthedContext extends Context {
  caller: Caller;
}

interface RouteOptions { limit?: number; anyOrigin?: boolean }
type PublicHandler = (ctx: Context) => Promise<Reply | null>;
type CallerHandler = (ctx: AuthedContext) => Promise<Reply | null>;
type Route = { method: string; segments: string[]; options: RouteOptions } & ({ open: true; handler: PublicHandler } | { open: false; handler: CallerHandler });

const routes: Route[] = [];

/** A route that needs a valid session cookie or agent token. */
export function route(method: string, pattern: string, handler: CallerHandler, options: RouteOptions = {}): void {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), options, open: false, handler });
}

/** A route that needs no credential. */
export function publicRoute(method: string, pattern: string, handler: PublicHandler, options: RouteOptions = {}): void {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), options, open: true, handler });
}

function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split("/").filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length && ok; i++) {
      const seg = candidate.segments[i];
      if (seg.startsWith(":")) {
        try { params[seg.slice(1)] = decodeURIComponent(parts[i]); } catch { ok = false; }
      } else ok = seg === parts[i];
    }
    if (ok) return { route: candidate, params };
  }
  return null;
}

function limitFor(method: string, path: string): number {
  return match(method, path)?.route.options.limit ?? BODY_LIMIT;
}

/** Reads the whole body; past the limit the rest is drained and discarded, never kept. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    let tooLarge = declared > limit;
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const STATE_CHANGING = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);
const publicOrigin = new URL(config.publicUrl).origin;

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const scheme = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return origin === `${scheme}://${req.headers.host ?? ""}` || origin === publicOrigin;
}

export function send(res: ServerResponse, reply: Reply, head = false): void {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", ...reply.headers };
  let payload: Buffer | string | undefined = reply.body;
  if (reply.json !== undefined) {
    payload = JSON.stringify(reply.json);
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Cache-Control"] ??= "no-store";
  } else if (reply.contentType) headers["Content-Type"] = reply.contentType;
  if (payload !== undefined) headers["Content-Length"] = String(Buffer.byteLength(payload));
  res.writeHead(reply.status, headers);
  res.end(head ? undefined : payload);
}

const sendError = (res: ServerResponse, error: HttpError) => send(res, { status: error.status, json: error.body });

type Fallback = (ctx: Context) => Promise<Reply | null>;

export async function handle(req: IncomingMessage, res: ServerResponse, fallback: Fallback): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://local");
  const path = url.pathname;
  try {
    const raw = await readBody(req, limitFor(method, path));
    if (raw === null) throw payloadTooLarge(limitFor(method, path));
    const isReviewPath = path.startsWith("/review/") || path.startsWith("/api/review/");
    if (isReviewPath && method !== "GET" && method !== "HEAD") throw readOnlyRoute();
    const found = match(method === "HEAD" ? "GET" : method, path);
    if (STATE_CHANGING(method) && !found?.route.options.anyOrigin && !sameOrigin(req)) throw crossOrigin();
    const ctx: Context = {
      method, path, query: url.searchParams, params: found?.params ?? {}, headers: req.headers, raw, res,
      body() {
        if (raw.length === 0) return undefined;
        try { return JSON.parse(raw.toString("utf8")) as unknown; } catch { throw invalid({ body: "Send a JSON body" }); }
      },
    };
    if (!found) {
      const reply = await fallback(ctx);
      if (!reply) throw notFound();
      send(res, reply, method === "HEAD");
      return;
    }
    let reply: Reply | null;
    if (found.route.open) reply = await found.route.handler(ctx);
    else {
      const caller = await authenticate(req.headers);
      if (!caller) throw unauthenticated();
      reply = await found.route.handler({ ...ctx, caller });
    }
    if (reply) send(res, reply, method === "HEAD");
  } catch (error) {
    if (res.headersSent) { res.end(); return; }
    if (error instanceof HttpError) { sendError(res, error); return; }
    console.error(`${method} ${path} failed:`, error);
    sendError(res, internalError());
  }
}
