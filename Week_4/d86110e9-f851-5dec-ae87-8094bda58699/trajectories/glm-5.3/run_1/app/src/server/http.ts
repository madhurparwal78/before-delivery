// The HTTP layer: one request wrapper, one error envelope, cookie sessions,
// body parsing with the API's size, type and depth rules.

import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, Errors } from "./errors.js";
import { db } from "./db.js";
import type { Db } from "./db.js";

export type JsonBody = Record<string, unknown>;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  query: Record<string, string>;
  params: Record<string, string>;
  body: unknown;
  rawBody: Buffer;
  session: string | null;
  userId: string | null;
  db: Db;
}

export interface Handler {
  (ctx: Ctx): Promise<{ status: number; body?: unknown; headers?: Record<string, string> } | void>;
}

export interface RouteRule {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  public?: boolean;
  raw?: boolean;
}

const JSON_LIMIT = 65536;

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > limit) {
        reject(new ApiError(413, limit === JSON_LIMIT ? "Body is larger than 65536 bytes" : `Body is larger than ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function parseJsonBody(raw: Buffer): unknown {
  let v: unknown;
  try {
    v = JSON.parse(raw.toString("utf8"));
  } catch {
    throw Errors.invalidJson();
  }
  if (depth(v) > 20) throw Errors.nestedTooDeep();
  return v;
}

function depth(v: unknown, d = 0): number {
  if (d > 25) return d;
  if (Array.isArray(v)) return 1 + Math.max(...v.map((x) => depth(x, d + 1)), 0);
  if (v && typeof v === "object") {
    let m = 0;
    for (const k in v as Record<string, unknown>) {
      const dd = depth((v as Record<string, unknown>)[k], d + 1);
      if (dd > m) m = dd;
    }
    return 1 + m;
  }
  return 0;
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function requireObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Errors.notJsonObject();
  return body as Record<string, unknown>;
}

export function str(v: unknown): string { return typeof v === "string" ? v : ""; }

export function hasOwn(body: Record<string, unknown>, k: string): boolean { return Object.prototype.hasOwnProperty.call(body, k); }

export const obj = (o: Record<string, unknown> | null | undefined): Record<string, unknown> => o ?? {};

export function send(res: ServerResponse, status: number, body?: unknown, headers?: Record<string, string>): void {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(headers ?? {}),
  });
  res.end(text);
}

export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host ?? "";
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch {
    return false;
  }
}
