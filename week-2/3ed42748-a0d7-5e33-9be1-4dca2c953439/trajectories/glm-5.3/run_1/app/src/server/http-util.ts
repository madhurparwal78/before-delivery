import type { IncomingMessage, ServerResponse } from "node:http";
import { Errors, ApiError } from "./errors.js";
import type { AppConfig } from "./config.js";
import { baseUrl } from "./config.js";
import type { CourierRow } from "./domain.js";

// The app's own origins: exactly two — the public URL's origin and the request's Host.

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  cfg: AppConfig;
  url: URL;
  body: Buffer;
  session: { token: string; courier: CourierRow } | null;
  json: unknown | undefined; // parsed lazily by handlers that take a JSON body
};

export function ownOrigins(cfg: AppConfig, req: IncomingMessage): string[] {
  const origins: string[] = [];
  if (cfg.publicUrl) {
    try {
      origins.push(new URL(cfg.publicUrl).origin.toLowerCase());
    } catch {
      // an unusable public URL is ignored; the Host origin still applies
    }
  }
  const host = req.headers.host;
  if (host) origins.push(`http://${host}`.toLowerCase());
  return origins;
}

export function isForeignOrigin(cfg: AppConfig, req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  if (origin === "null") return true;
  const own = ownOrigins(cfg, req);
  try {
    const o = new URL(origin).origin.toLowerCase();
    return !own.includes(o);
  } catch {
    return true;
  }
}

const JSON_RE = /^application\/json(\s*;|$)/i;

export type BodyKind = "json" | "png" | "none";

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    total += b.length;
    if (total > limit) throw Errors.tooLarge();
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

export function checkContentType(req: IncomingMessage, kind: BodyKind): void {
  if (kind === "none") return;
  const ct = req.headers["content-type"];
  if (kind === "png") {
    const media = ct?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (media !== "image/png") throw Errors.unsupportedMediaType();
    return;
  }
  if (ct === undefined) {
    // A zero-byte body is judged as {} whatever its content type; the empty check happens in the caller.
    return;
  }
  if (!JSON_RE.test(ct)) throw Errors.unsupportedMediaType();
}

export function sendJson(res: ServerResponse, status: number, body: string, extraHeaders?: Record<string, string>): void {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    Date: new Date().toUTCString(),
    "Cache-Control": "no-store",
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(body);
}

export function sendHtml(res: ServerResponse, status: number, html: string, extraHeaders?: Record<string, string>): void {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(html)),
    Date: new Date().toUTCString(),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(html);
}

export function sendBytes(res: ServerResponse, status: number, bytes: Buffer, contentType: string, extraHeaders?: Record<string, string>): void {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(bytes.length),
    Date: new Date().toUTCString(),
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(bytes);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof ApiError) {
    sendJson(res, err.status, err.body(), err.headers);
    return;
  }
  sendJson(res, 500, Errors.internal().body());
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function base(cfg: AppConfig): string {
  return baseUrl(cfg);
}
