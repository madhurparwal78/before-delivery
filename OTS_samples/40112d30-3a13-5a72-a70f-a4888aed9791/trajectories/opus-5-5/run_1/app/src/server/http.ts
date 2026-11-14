import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "./errors.js";

export const JSON_LIMIT = 1_000_000;

export interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer | string;
  headers?: Record<string, string>;
  cookies?: string[];
}

export class Ctx {
  readonly url: URL;
  readonly cookies: Record<string, string>;
  params: string[] = [];
  body: unknown = undefined;
  readonly setCookies: string[] = [];

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
  ) {
    this.url = new URL(req.url ?? "/", "http://local");
    this.cookies = parseCookies(req.headers.cookie ?? "");
  }

  get method(): string {
    return this.req.method ?? "GET";
  }

  get path(): string {
    return this.url.pathname;
  }

  get ip(): string {
    return (this.req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
  }

  header(name: string): string | null {
    const value = this.req.headers[name.toLowerCase()];
    return typeof value === "string" ? value : null;
  }

  setCookie(name: string, value: string, maxAgeSeconds: number | null): void {
    const age = maxAgeSeconds === null ? "" : `; Max-Age=${maxAgeSeconds}`;
    this.setCookies.push(`${name}=${value}; Path=/; HttpOnly; SameSite=Lax${age}`);
  }

  /** The browser's device id for respondent routes, set on first use. */
  device(): string {
    const existing = this.cookies.nf_device;
    if (existing && /^[a-f0-9]{48}$/.test(existing)) return existing;
    const created = randomBytes(24).toString("hex");
    this.cookies.nf_device = created;
    this.setCookie("nf_device", created, 60 * 60 * 24 * 365 * 5);
    return created;
  }

  /** The JSON body as an object; anything else counts as an empty object. */
  json(): Record<string, unknown> {
    return this.body && typeof this.body === "object" && !Array.isArray(this.body) ? (this.body as Record<string, unknown>) : {};
  }
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

/** Reads the request body up to `limit` bytes, refusing larger ones with 413. */
export function readBody(req: IncomingMessage, limit: number, tooLarge: () => ApiError): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > limit) {
      req.resume();
      reject(tooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => reject(error));
  });
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  rawBody: boolean;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, rawBody = false): void {
    const pattern = new RegExp(`^${path.replace(/:[a-z_]+/g, "([^/]+)")}$`);
    this.routes.push({ method, pattern, handler, rawBody });
  }

  match(method: string, path: string): { route: Route; params: string[] } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(path);
      if (match) return { route, params: match.slice(1).map((p) => decodeURIComponent(p)) };
    }
    return null;
  }
}

export function json(status: number, body?: unknown): Reply {
  return { status, body };
}

export function send(ctx: Ctx, reply: Reply): void {
  const headers: Record<string, string | string[]> = { "Cache-Control": "no-store", ...(reply.headers ?? {}) };
  const cookies = [...ctx.setCookies, ...(reply.cookies ?? [])];
  if (cookies.length) headers["Set-Cookie"] = cookies;
  if (reply.raw !== undefined) {
    ctx.res.writeHead(reply.status, headers);
    ctx.res.end(reply.raw);
    return;
  }
  if (reply.body === undefined) {
    ctx.res.writeHead(reply.status, headers);
    ctx.res.end();
    return;
  }
  headers["Content-Type"] = "application/json; charset=utf-8";
  ctx.res.writeHead(reply.status, headers);
  ctx.res.end(JSON.stringify(reply.body));
}
