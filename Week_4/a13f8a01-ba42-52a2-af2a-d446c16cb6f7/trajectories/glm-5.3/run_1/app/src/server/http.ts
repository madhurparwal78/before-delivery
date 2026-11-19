import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../shared/config.js";
import type { ErrorBody } from "../shared/errors.js";
import type { UserRow } from "./domain.js";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  config: AppConfig;
  user: UserRow | null;
  body: unknown;
  rawBody: Buffer | null;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": buf.length,
  });
  res.end(buf);
}

export function sendError(res: ServerResponse, status: number, body: ErrorBody): void {
  sendJson(res, status, body);
}

export function send404(res: ServerResponse): void {
  sendJson(res, 404, { error: "not_found", message: "Nothing here." });
}

export async function readBody(req: IncomingMessage, limit: number): Promise<{ ok: true; buf: Buffer } | { ok: false; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > limit) return { ok: false, tooLarge: true };
    chunks.push(b);
  }
  return { ok: true, buf: Buffer.concat(chunks) };
}

export function parseJsonBody(buf: Buffer): unknown {
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}
