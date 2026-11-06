import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "./env.ts";
import type { Client } from "./db.ts";
import { ApiError, errorBody } from "./errors.ts";
import type { Ctx } from "./scope.ts";

export interface AuthedRequest {
  req: IncomingMessage;
  res: ServerResponse;
  cfg: Config;
  url: URL;
  method: string;
  cookies: Record<string, string>;
  body: unknown;
  rawBody: Buffer;
}

export type Handler = (r: AuthedRequest) => Promise<void>;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function writeJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export function writeError(res: ServerResponse, err: ApiError): void {
  writeJson(res, err.status, errorBody(err));
}

const JSON_LIMIT = 1_000_000;

export async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<{ body: unknown; raw: Buffer } | { error: ApiError }> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > JSON_LIMIT) {
    return { error: new ApiError("too_large", "The request body is too large.") };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > JSON_LIMIT) {
      return { error: new ApiError("too_large", "The request body is too large.") };
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) return { body: {}, raw };
  try {
    return { body: JSON.parse(raw.toString("utf8")), raw };
  } catch {
    return { error: new ApiError("validation", "The request body is not valid JSON.") };
  }
}

export function requireJsonContentType(req: IncomingMessage): ApiError | null {
  const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (ct !== "application/json") {
    return new ApiError("unsupported_media_type", "Send the request as application/json.");
  }
  return null;
}

/** Same-origin rule: state-changing requests from another origin are refused. */
export function crossOriginCheck(req: IncomingMessage, origin: string | undefined): ApiError | null {
  const method = (req.method ?? "GET").toUpperCase();
  const changing = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (!changing || !origin) return null;
  try {
    const u = new URL(origin);
    const host = req.headers.host;
    if (host && u.host !== host) {
      return new ApiError("cross_origin", "Requests from other origins are not allowed.");
    }
  } catch {
    return new ApiError("cross_origin", "Requests from other origins are not allowed.");
  }
  return null;
}

export interface RouteMatch {
  params: Record<string, string>;
  handler: string; // handler name for the dispatcher
}

export function matchRoute(method: string, path: string, routes: { method: string; pattern: string; handler: string }[]): RouteMatch | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const rp = route.pattern.split("/").filter(Boolean);
    const pp = path.split("/").filter(Boolean);
    if (rp.length !== pp.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith("{") && rp[i].endsWith("}")) {
        params[rp[i].slice(1, -1)] = decodeURIComponent(pp[i]);
      } else if (rp[i] !== pp[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { params, handler: route.handler };
  }
  return null;
}
