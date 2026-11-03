import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "../shared/errors.js";
import { config } from "./config.js";

export const JSON_LIMIT = 1_000_000;
export const UPLOAD_LIMIT = 5_100_000;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
}

/** Read the request body, refusing it with 413 as soon as it passes `limit` bytes. */
export async function readBody(req: IncomingMessage, limit: number, tooLarge: () => ApiError): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      req.resume();
      throw tooLarge();
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function parseJson(raw: Buffer): unknown {
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError(422, "invalid", "The body is not valid JSON.", { "": "The body is not valid JSON." });
  }
}

/** A request whose Origin header names another origin. Requests without Origin are accepted. */
export function fromOtherOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers.host;
  const own = new Set([new URL(config.publicUrl).origin, `http://${host}`, `https://${host}`]);
  return !own.has(origin);
}

export function changesState(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

export function baseHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  const body: { code: string; message: string; fields?: Record<string, string> } = { code: error.code, message: error.message };
  if (error.status === 422) body.fields = error.fields ?? {};
  sendJson(res, error.status, { error: body });
}

export function sendNoContent(res: ServerResponse, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(204, { "Cache-Control": "no-store", ...headers });
  res.end();
}

export function sendHtml(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(html);
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

/** A small method + path router; `:name` segments become params. */
export class Router {
  private readonly routes: Route[] = [];

  on(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_, key: string) => (keys.push(key), "([^/]+)"))}$`);
    this.routes.push({ method, pattern, keys, handler });
    return this;
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method && !(route.method === "GET" && method === "HEAD")) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])));
      return { handler: route.handler, params };
    }
    return pathMatched ? "method" : null;
  }
}
