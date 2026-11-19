import type { Request } from "express";
import { err } from "./http.js";
import { q, q1 } from "./db.js";
import { apiMessages } from "./copy.js";
import { config } from "./config.js";

export const JSON_LIMIT = 1_000_000;
export const PHOTO_LIMIT = 8_000_000;
export const WORKBOOK_LIMIT = 2_000_000;

export function appOrigin(req: Request): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, "");
  const host = req.headers.host ?? "localhost";
  return `http://${host}`;
}

/** One precedence order for every request, applied as middleware layers. */

export async function readJsonBody(req: Request): Promise<unknown> {
  const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType !== "" && contentType !== "application/json") {
    throw err.wrongType();
  }
  // express.raw has already buffered the body; read it without consuming a second time.
  const rawBody = (req as Request & { body?: unknown }).body;
  const text = typeof rawBody === "string" ? rawBody
    : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8")
    : rawBody && typeof rawBody === "object" ? JSON.stringify(rawBody)
    : "";
  if (text.length > JSON_LIMIT) {
    throw err.tooLarge(apiMessages.fieldLong(JSON_LIMIT));
  }
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw err.malformed();
  }
}

export function assertOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = req.headers.origin;
  if (!origin) return;
  const own = appOrigin(req);
  if (origin.replace(/\/$/, "") !== own.replace(/\/$/, "")) throw err.foreignOrigin();
}

export type Body = Record<string, unknown>;
export const asBody = (v: unknown): Body => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Body) : {});

export function depthOf(v: unknown, d = 0): number {
  if (d > 20) return d;
  if (typeof v === "object" && v !== null) {
    let max = d;
    for (const child of Object.values(v)) max = Math.max(max, depthOf(child, d + 1));
    return max;
  }
  return d;
}
export function assertDepth(v: unknown): void {
  if (depthOf(v) > 16) throw err.field({ body: apiMessages.notANumber });
}

export const isCamelKey = (k: string) => /^[$_]?[a-z][a-zA-Z0-9$]*$/.test(k) || /^[$_]?[A-Z][a-zA-Z0-9$]*$/.test(k);

export function assertCamelKeys(v: unknown): void {
  if (typeof v !== "object" || v === null) return;
  for (const [k, child] of Object.entries(v)) {
    if (!isCamelKey(k)) throw err.malformed();
    assertCamelKeys(child);
  }
}

/** Counting windows for per-desk and per-address limits. */
export async function countAndLimit(
  key: string,
  table: string,
  keyColumn: string,
  windowSeconds: number,
  limit: number,
  message: (retry: number) => string,
  nowOverride?: Date
): Promise<void> {
  const now = nowOverride ?? new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const rows = await q1<{ count: string }>(`SELECT count FROM ${table} WHERE ${keyColumn} = $1 AND window_start = $2`, [key, windowStart.toISOString()]);
  const count = rows ? Number(rows.count) : 0;
  if (count >= limit) {
    const retry = Math.max(1, Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000));
    throw err.limited(retry, message(retry));
  }
}

export async function bumpCount(table: string, keyColumn: string, key: string, windowSeconds: number, nowOverride?: Date): Promise<void> {
  const now = nowOverride ?? new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 1000) * 1000);
  await q(
    `INSERT INTO ${table} (${keyColumn}, window_start, count) VALUES ($1,$2,1)
     ON CONFLICT (${keyColumn}, window_start) DO UPDATE SET count = ${table}.count + 1`,
    [key, windowStart.toISOString()]
  );
  void windowSeconds;
}
