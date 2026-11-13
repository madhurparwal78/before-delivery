import type { IncomingMessage, ServerResponse } from "node:http";

// The API's one error shape: 422 `{"errors":{...}}`, everything else `{"error":{"code",...}}`.
type ErrorBody =
  | { error: { code: string; message?: string; [extra: string]: unknown } }
  | { errors: Record<string, string> };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(`${status}`);
  }
}

export function fail(status: number, code: string, extra: Record<string, unknown> = {}): never {
  throw new ApiError(status, { error: { code, ...extra } });
}

export function invalid(errors: Record<string, string>): never {
  throw new ApiError(422, { errors });
}

const JSON_LIMIT = 65_536;

export interface Request {
  method: string;
  url: URL;
  params: Record<string, string>;
  headers: IncomingMessage["headers"];
  cookies: Record<string, string>;
  raw: Buffer;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
  bytes?: Buffer;
}

type Handler = (req: Request) => Promise<Reply>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  bodyLimit: number;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, bodyLimit = JSON_LIMIT): void {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler, bodyLimit });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | "method" | null {
    const parts = path.split("/").filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const ok = route.segments.every((seg, i) => {
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
          return true;
        }
        return seg === parts[i];
      });
      if (!ok) continue;
      if (route.method === method) return { route, params };
      pathMatched = true;
    }
    return pathMatched ? "method" : null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export class BodyTooLarge extends Error {}

/** Reads the body, refusing (before anything else is decided) once it passes `limit` bytes. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) return Promise.reject(new BodyTooLarge());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLarge());
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function jsonBody(req: Request): unknown {
  if (!req.raw.length) return {};
  try {
    return JSON.parse(req.raw.toString("utf8")) as unknown;
  } catch {
    return fail(400, "malformed_json");
  }
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { "X-Content-Type-Options": "nosniff", ...reply.headers };
  if (reply.bytes) {
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(reply.body);
  res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(text);
}

export const ok = (body: unknown, status = 200): Reply => ({ status, body });
export const noContent = (): Reply => ({ status: 204 });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
