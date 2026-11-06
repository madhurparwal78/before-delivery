// The HTTP framework: one error shape, one precedence ladder, sessions,
// the body and file limits, the origin rule, and the JSON conventions.

import type { Config } from "./config";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import type { Db, Value } from "./db";
import type { Instant } from "../shared/tz";

export type Json = Record<string, unknown>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> | null = null,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

// The one way an error body is produced, matching the published shape.
export function errorBody(code: string, message: string, fields: Record<string, string> | null): string {
  const error: Json = { code, message };
  if (fields !== null) error.fields = fields;
  return JSON.stringify({ error });
}

export function throwJson(status: number, code: string, message: string, fields: Record<string, string> | null = null): never {
  throw new HttpError(status, code, message, fields);
}

export type Request = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Buffer;
  params: Record<string, string>;
  session: Session | null;
  config: Config;
};

export type Response = {
  status: number;
  headers: Record<string, string>;
  body: Buffer | string | null;
};

export function jsonResponse(status: number, value: Json | unknown[]): Response {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
  };
}

export function emptyResponse(status: number): Response {
  return { status, headers: {}, body: null };
}

export function bytesResponse(status: number, contentType: string, body: Buffer, extra: Record<string, string> = {}): Response {
  return { status, headers: { "content-type": contentType, ...extra }, body };
}

export function textResponse(status: number, contentType: string, text: string, extra: Record<string, string> = {}): Response {
  return { status, headers: { "content-type": contentType, ...extra }, body: text };
}

// A whole-second UTC instant of now; the server alone decides time.
export function now(): Instant {
  return Math.floor(Date.now() / 1000);
}

export type Session = {
  id: string;
  deskId: string;
  expiresAt: Instant;
};

export function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

export function passwordMatches(password: string, salt: string, hash: string): boolean {
  const computed = Buffer.from(hashPassword(password, salt));
  const held = Buffer.from(hash);
  return computed.length === held.length && timingSafeEqual(computed, held);
}

export function newSalt(): string {
  return randomUUID().replace(/-/g, "");
}

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

export const SESSION_COOKIE = "clapstick_session";

export function cookieOf(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax`;
}

// Multipart form data parsing: files come as one part each, and the whole
// body's size limit is judged on Content-Length before reading.
export type Part = { name: string; filename: string | null; contentType: string | null; data: Buffer };

export function parseMultipart(body: Buffer, contentType: string): Part[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!match) return [];
  const boundary = `--${match[1] ?? match[2]}`;
  const parts: Part[] = [];
  let at = body.indexOf(Buffer.from(boundary, "latin1"));
  while (at !== -1) {
    const start = at + boundary.length;
    if (body.subarray(start, start + 2).toString("latin1") === "--") break;
    const headEnd = body.indexOf(Buffer.from("\r\n\r\n", "latin1"), start);
    if (headEnd === -1) break;
    const head = body.subarray(start + 2, headEnd).toString("latin1");
    const next = body.indexOf(Buffer.from(boundary, "latin1"), headEnd);
    if (next === -1) break;
    const data = body.subarray(headEnd + 4, next - 2);
    const nameMatch = /name="([^"]*)"/.exec(head);
    const fileMatch = /filename="([^"]*)"/.exec(head);
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(head);
    parts.push({
      name: nameMatch ? nameMatch[1]! : "",
      filename: fileMatch ? decodeMime(fileMatch[1]!) : null,
      contentType: typeMatch ? typeMatch[1]!.trim() : null,
      data,
    });
    at = next;
  }
  return parts;
}

function decodeMime(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

export function findFile(parts: Part[], name: string): Part | null {
  return parts.find((p) => p.name === name && p.filename !== null) ?? null;
}

// The JSON body limit, published: 1,000,000 bytes allowed.
export const JSON_BODY_LIMIT = 1000000;
// The upload whole-body limit, published: 9,000,000 bytes allowed.
export const UPLOAD_BODY_LIMIT = 9000000;
// A frame or script file's own limit, published: 8,000,000 bytes.
export const FRAME_FILE_LIMIT = 8000000;
// A producer attachment's own limit, published: 5,000,000 bytes.
export const ATTACHMENT_FILE_LIMIT = 5000000;

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function jsonOf(req: Request): Json {
  if (req.body.length === 0) return {};
  try {
    const parsed = JSON.parse(req.body.toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throwJson(400, "malformedJson", "The body should be a JSON object.");
    }
    return parsed as Json;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throwJson(400, "malformedJson", "The body should be a JSON object.");
  }
}

export function fieldOf(body: Json, key: string): unknown {
  return body[key];
}

export function strOf(body: Json, key: string): string | null {
  const v = body[key];
  return typeof v === "string" ? v : null;
}

export function numOf(body: Json, key: string): number | null {
  const v = body[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function boolOf(body: Json, key: string): boolean | null {
  const v = body[key];
  return typeof v === "boolean" ? v : null;
}

// A whole-second UTC instant from the wire format.
export function instantOfText(text: string): Instant | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(text);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) / 1000);
}

// `yyyy-mm-dd`, plain and whole.
export function dateOfText(text: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return text;
}

export function timeOfText(text: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const h = Number(text.slice(0, 2));
  const m = Number(text.slice(3, 5));
  if (h > 23 || m > 59) return null;
  return text;
}

// A `q` search text: trimmed, non-empty means a search.
export function searchOf(q: string | null): string | null {
  if (q === null) return null;
  const trimmed = q.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export type Desk = {
  id: string;
  name: string;
  email: string;
};

// The session cookie is HttpOnly, SameSite=Lax, never Secure, with no
// Max-Age or Expires; its life is decided by the server alone.
export async function loadSession(db: Db, config: Config, cookie: string | undefined): Promise<Session | null> {
  if (!cookie) return null;
  const value = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!value) return null;
  const token = value.slice(SESSION_COOKIE.length + 1);
  if (token.length === 0) return null;
  const row = await db.one(
    "select id, desk_id, expires_at from sessions where token = $1",
    [token],
  );
  if (row === null) return null;
  const session: Session = {
    id: String(row.id),
    deskId: String(row.desk_id),
    expiresAt: Number(row.expires_at),
  };
  if (session.expiresAt <= now()) {
    // An expired cookie stays long enough to be told apart from an unknown one,
    // so the 401 carries the code session_ended.
    await db.query(
      "insert into ended_sessions (token, at) values ($1, $2)",
      [token, String(now())],
    );
    await db.query("delete from sessions where token = $1", [token]);
    return null;
  }
  void config;
  return session;
}

// Whether a cookie's session has ended, as against one that never existed.
export async function sessionEnded(db: Db, token: string): Promise<boolean> {
  const row = await db.one("select token from ended_sessions where token = $1", [token]);
  return row !== null;
}

export async function createSession(db: Db, config: Config, deskId: string): Promise<string> {
  const token = newToken();
  const expiresAt = now() + config.timers.sessionSeconds;
  await db.query(
    "insert into sessions (id, desk_id, token, created_at, expires_at) values ($1, $2, $3, $4, $5)",
    [newId(), deskId, token, String(now()), String(expiresAt)],
  );
  return token;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.query("delete from sessions where token = $1", [token]);
}

export function tokenOfCookie(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const value = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!value) return null;
  const token = value.slice(SESSION_COOKIE.length + 1);
  return token.length === 0 ? null : token;
}

export function asValue(v: string | number | null): Value {
  return v;
}
