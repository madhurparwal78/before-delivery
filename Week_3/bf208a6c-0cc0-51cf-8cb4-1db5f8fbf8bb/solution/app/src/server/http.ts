import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: object,
  ) {
    super(JSON.stringify(body));
  }
}

export const notFound = (): ApiError => new ApiError(404, { error: "not_found" });
export const passwordRequired = (): ApiError => new ApiError(403, { error: "password_required" });
export const signInRequired = (): ApiError => new ApiError(401, { error: "sign_in_required" });
export const forbidden = (): ApiError => new ApiError(403, { error: "forbidden" });
export const invalid = (errors: Record<string, string>): ApiError => new ApiError(422, { errors });
export const conflict = (error: string, extra: object = {}): ApiError => new ApiError(409, { error, ...extra });
export const serviceDown = (error: "storage_unavailable" | "mail_unavailable"): ApiError => new ApiError(503, { error });

export interface Request {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  cookies: Record<string, string>;
  /** Raw body, read only for routes that declare one. */
  body: Buffer;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAgeSeconds?: number): void {
  const attributes = ["Path=/", "HttpOnly", "SameSite=Lax"];
  if (maxAgeSeconds !== undefined) attributes.push(`Max-Age=${maxAgeSeconds}`);
  const existing = res.getHeader("Set-Cookie");
  const list = Array.isArray(existing) ? existing.map(String) : existing === undefined ? [] : [String(existing)];
  res.setHeader("Set-Cookie", [...list, `${name}=${encodeURIComponent(value)}; ${attributes.join("; ")}`]);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": payload.length });
  res.end(payload);
}

/** The request origin the browser reports must be this app's own. */
export function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  try {
    const host = new URL(origin).host;
    return host !== req.headers.host && host !== new URL(config.publicUrl).host;
  } catch {
    return true;
  }
}

const DRAIN_LIMIT_BYTES = 32_000_000;

/** Reads the body up to `limit` bytes. Past the limit the rest is drained unread so the client can still receive the 413. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too_large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > DRAIN_LIMIT_BYTES) req.destroy();
      if (over) return;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? "too_large" : Buffer.concat(chunks)));
    req.on("error", reject);
    req.on("close", () => {
      if (!req.complete) resolve("too_large");
    });
  });
}

/** A body that is not a JSON object carries no fields, so validation answers for it like for an empty one. */
export function parseJson(body: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function param(request: Request, name: string): string {
  const value = request.params[name];
  if (value === undefined) throw notFound();
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids are checked before any lookup, so a malformed one never reaches the database. */
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** What a route answers with. `null` means the handler already wrote the response (a stream). */
export type Reply =
  | { status: number; body?: unknown }
  | { status: number; headers: Record<string, string>; raw: Buffer }
  | null;

export const json = (status: number, body: unknown): Reply => ({ status, body });
export const empty = (status: number): Reply => ({ status });
