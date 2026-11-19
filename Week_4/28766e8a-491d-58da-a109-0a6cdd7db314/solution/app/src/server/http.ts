// The HTTP boundary (brief: API General, Server boundary): JSON in and out, 1,000,000-byte limit,
// same-origin state changes, one error shape for every route.
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "../shared/errors";
import { config } from "./config";

const BODY_LIMIT = 1_000_000;

export interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  params: string[];
  headers: IncomingMessage["headers"];
  body: unknown;
  cookies: Map<string, string>;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
}

type Handler = (req: Request) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const routes: Route[] = [];

/** Registers a route; `:id` segments become positional params. */
export function route(method: string, path: string, handler: Handler): void {
  const pattern = new RegExp(`^${path.replace(/:[a-z]+/g, "([^/]+)")}$`);
  routes.push({ method, pattern, handler });
}

export function findRoute(method: string, path: string): { handler: Handler; params: string[] } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const match = r.pattern.exec(path);
    if (match) return { handler: r.handler, params: match.slice(1).map(decodeURIComponent) };
  }
  return null;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return out;
}

/** True when the Origin header is absent or names this app. */
export function sameOrigin(headers: IncomingMessage["headers"]): boolean {
  const origin = headers.origin;
  if (!origin) return true;
  const own = new Set([new URL(config.publicUrl).origin]);
  if (headers.host) {
    own.add(`http://${headers.host}`);
    own.add(`https://${headers.host}`);
  }
  return own.has(origin);
}

export async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > BODY_LIMIT) tooLarge = true;
    else chunks.push(chunk);
  }
  if (tooLarge) throw new ApiError("too_large");
  if (size === 0) return undefined;
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new ApiError("unsupported_media_type");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError("unsupported_media_type");
  }
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers).end();
    return;
  }
  if (Buffer.isBuffer(reply.body)) {
    res.writeHead(reply.status, headers).end(reply.body);
    return;
  }
  res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", ...headers }).end(JSON.stringify(reply.body));
}

export function errorReply(error: ApiError): Reply {
  return { status: error.status, body: error.body() };
}

export function json(status: number, body: unknown, headers?: Record<string, string | string[]>): Reply {
  return headers ? { status, body, headers } : { status, body };
}

/** Narrows an unknown JSON body to an object (an absent body counts as empty). */
export function objectBody(body: unknown): Record<string, unknown> {
  if (body === undefined) return {};
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ApiError("invalid");
  return body as Record<string, unknown>;
}
