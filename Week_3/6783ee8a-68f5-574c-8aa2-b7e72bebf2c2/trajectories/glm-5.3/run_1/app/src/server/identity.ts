import { createHash, createHmac, randomBytes } from "node:crypto";
import { one, query } from "./db.ts";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function uuid(): string {
  return crypto.randomUUID();
}

function pepper(): string {
  const url = process.env.DATABASE_URL ?? "";
  return createHash("sha256").update(`brackenpad-session-pepper:${url}`).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = createHmac("sha256", `${pepper()}:${salt}`).update(password).digest("hex");
  return `keyed:${salt}:${digest}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split(":");
  if (scheme !== "keyed" || salt === undefined || digest === undefined) return false;
  const check = createHmac("sha256", `${pepper()}:${salt}`).update(password).digest("hex");
  return check === digest;
}

function sessionSignature(id: string): string {
  return createHmac("sha256", pepper()).update(id).digest("base64url").slice(0, 32);
}

export async function createSession(userId: string): Promise<string> {
  const id = newId("s");
  await query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [id, userId]);
  return `${id}.${sessionSignature(id)}`;
}

export type SessionUser = { id: string; email: string; display_name: string; verified: boolean };

export async function userFromSession(cookieValue: string | undefined): Promise<SessionUser | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot < 0) return null;
  const id = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = createHmac("sha256", pepper()).update(id).digest("base64url").slice(0, 32);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  const row = await one<{ id: string; email: string; display_name: string; verified: boolean }>(
    "SELECT u.id, u.email, u.display_name, u.verified FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1",
    [id],
  );
  return row ?? null;
}

export async function endSession(cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  const dot = cookieValue.indexOf(".");
  if (dot < 0) return;
  const id = cookieValue.slice(0, dot);
  await query("DELETE FROM sessions WHERE id = $1", [id]);
}

export async function purgeStale(timeoutMs: number): Promise<void> {
  const interval = `${timeoutMs} milliseconds`;
  await query("DELETE FROM presence WHERE last_seen < now() - ($1)::interval", [interval]);
  await query("DELETE FROM locks WHERE last_seen < now() - ($1)::interval", [interval]);
}

export async function isDbUp(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
