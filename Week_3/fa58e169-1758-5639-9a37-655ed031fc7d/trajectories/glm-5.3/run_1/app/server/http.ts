import type { IncomingMessage, ServerResponse } from "node:http";
import { env, sql } from "../common/env";

export const SESSION_COOKIE = "twinrow_session";

export interface BodyResult {
  ok: boolean;
  body?: unknown;
}

/**
 * The one place a request body is read: JSON only, at most 1,000,000 bytes,
 * both checks made before the error order runs. On failure the error response
 * is sent here, so no caller can fall through to the 404 handler.
 */
export async function readJson(req: IncomingMessage, res: ServerResponse): Promise<BodyResult> {
  const contentType = String(req.headers["content-type"] ?? "").split(";")[0]!.trim();
  const write = typeof req.method === "string" && req.method !== "GET" && req.method !== "DELETE";
  if (write && contentType !== "application/json") {
    send(res, 415, { error: "unsupported_media_type" });
    return { ok: false };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) {
      send(res, 413, { error: "too_large" });
      return { ok: false };
    }
    chunks.push(chunk as Buffer);
  }
  if (!write) return { ok: true, body: undefined };
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    send(res, 422, { error: "invalid", field: "body", message: "The request body is not valid JSON." });
    return { ok: false };
  }
}

export function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(body);
}

export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { "cache-control": "no-store" });
  res.end();
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  reduceMotion: boolean;
}

interface SessionRow {
  id: string;
  name: string;
  email: string;
  reduce_motion: boolean;
}

/** The signed-in user of a request, or null. */
export async function currentUser(req: IncomingMessage): Promise<SessionUser | null> {
  const cookies = parseCookies(String(req.headers.cookie ?? ""));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const rows = await sql<SessionRow>(
    `SELECT u.id, u.name, u.email, u.reduce_motion FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, reduceMotion: row.reduce_motion };
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key !== "") out[key] = decodeURIComponent(value);
  }
  return out;
}

export function setSessionCookie(res: ServerResponse, tokenValue: string): void {
  const secure = env.publicUrl.startsWith("https");
  res.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(tokenValue)}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function todayString(): string {
  return env.today;
}
