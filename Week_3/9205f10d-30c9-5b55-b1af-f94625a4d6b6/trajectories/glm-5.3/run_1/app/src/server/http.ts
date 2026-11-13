import { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, notFound } from "./errors.js";

export const JSON_BODY_LIMIT = 65_536;
export const UPLOAD_BODY_LIMIT = 5_250_000;
export const CERT_FILE_LIMIT = 5_000_000;

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  body: unknown;
  rawBody: Buffer;
  sessionToken: string | null;
  params: Record<string, string>;
};

export type Handler = (ctx: Ctx) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> } | void>;

type Route = {
  method: string;
  path: string;
  pattern: Array<string | { param: string }>;
  handler: Handler;
};

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    const segments = path.split("/").filter((s) => s.length > 0);
    const pattern = segments.map((s) => (s.startsWith(":") ? { param: s.slice(1) } : s));
    this.routes.push({ method, pattern, handler, path });
  }

  routesOf(): Array<{ method: string; path: string; handler: Handler }> {
    return this.routes.map((r) => ({ method: r.method, path: r.path, handler: r.handler }));
  }

  /** Returns matched params, or null when no route matches. */
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = path.split("/").filter((s) => s.length > 0);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.pattern.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.pattern[i];
        if (seg === undefined) { ok = false; break; }
        if (typeof seg === "string") {
          const want = parts[i];
          if (want === undefined || seg !== want) { ok = false; break; }
        } else {
          const value = parts[i];
          if (value === undefined) { ok = false; break; }
          params[seg.param] = decodeURIComponent(value);
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

export function readBody(req: IncomingMessage, limit: number): Promise<{ ok: true; buffer: Buffer } | { ok: false; tooLarge: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        chunks.length = 0;
        resolve({ ok: false, tooLarge: true });
        // stop reading: drain the rest so the client gets our response instead of a reset
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve({ ok: true, buffer: Buffer.concat(chunks) });
      }
    });
    req.on("error", () => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, tooLarge: false });
      }
    });
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: ApiError): void {
  sendJson(res, err.status, err.body());
}

export function isSameOrigin(ctx: Ctx): boolean {
  const origin = ctx.req.headers.origin;
  if (!origin) return true;
  const host = ctx.req.headers.host;
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch {
    return false;
  }
}

export { notFound };
