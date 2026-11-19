// Opaque listing cursors (adapted from kit/modules/cursor): keyset position plus the surface and workspace that
// issued it, signed so an altered, made-up or foreign cursor is refused (brief: Tenancy > Cursors).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { one, pool } from "./db.js";

type Surface = "references" | "feed";

let key: Buffer | null = null;

/** The signing key lives in Postgres so every instance shares it. */
export async function loadCursorKey(): Promise<void> {
  await pool.query("INSERT INTO app_settings (key, value) VALUES ('cursor_key', $1) ON CONFLICT DO NOTHING", [randomBytes(32).toString("hex")]);
  const row = await one<{ value: string }>(pool, "SELECT value FROM app_settings WHERE key = 'cursor_key'");
  key = Buffer.from(row?.value ?? "", "hex");
}

function sign(payload: string): Buffer {
  if (!key) throw new Error("cursor key not loaded");
  return createHmac("sha256", key).update(payload).digest().subarray(0, 18);
}

export function encodeCursor(surface: Surface, scope: string, sortValue: Date, id: string): string {
  const payload = Buffer.from(JSON.stringify([surface, scope, sortValue.toISOString(), id])).toString("base64url");
  return `${payload}.${sign(payload).toString("base64url")}`;
}

export function decodeCursor(cursor: string, surface: Surface, scope: string): { sortValue: Date; id: string } | null {
  const [payload, signature, extra] = cursor.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = sign(payload);
  if (given.length !== expected.length || given.toString("base64url") !== signature || !timingSafeEqual(given, expected)) return null;
  const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!Array.isArray(decoded) || decoded.length !== 4) return null;
  const [s, w, sort, id] = decoded as unknown[];
  if (s !== surface || w !== scope || typeof sort !== "string" || typeof id !== "string") return null;
  return { sortValue: new Date(sort), id };
}

/** Limit rule shared by reference listings and the feed: whole numbers of 1 or more, capped. */
export function parseLimit(raw: string | null, fallback: number, max: number): number | null {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value < 1 ? null : Math.min(value, max);
}
