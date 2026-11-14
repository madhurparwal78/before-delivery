import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { formatBusinessTime } from "../shared/time.js";
import { config } from "./config.js";
import { query, transaction, type Queryable } from "./db.js";
import { FIELD, fail, type Fields } from "./errors.js";
import { json, parseJson, type Context, type Router } from "./http.js";
import { sendMail } from "./mail.js";

export const SESSION_COOKIE = "joinery_session";
const SESSION_DAYS = 30;
const MAX_CODE_ATTEMPTS = 5;

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 40;
}

export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export async function userForSession(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await query<{ id: string; email: string; display_name: string }>(
    "SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > $2",
    [token, new Date()],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name } : null;
}

export async function requireUser(ctx: Context): Promise<User> {
  const user = await userForSession(ctx.cookies[SESSION_COOKIE]);
  if (!user) throw fail.signedOut();
  return user;
}

export async function createSession(db: Queryable, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [
    token,
    userId,
    new Date(Date.now() + SESSION_DAYS * 86400 * 1000),
  ]);
  return token;
}

/** Finds a user by email, or creates one with the given display name. */
export async function findOrCreateUser(db: Queryable, email: string, displayName: string): Promise<User> {
  const existing = await db.query<{ id: string; email: string; display_name: string }>(
    "SELECT id, email, display_name FROM users WHERE email_key = $1",
    [emailKey(email)],
  );
  const row = existing.rows[0];
  if (row) return { id: row.id, email: row.email, displayName: row.display_name };
  const id = randomUUID();
  await db.query("INSERT INTO users (id, email, email_key, display_name, created_at) VALUES ($1, $2, $3, $4, $5)", [
    id,
    email.trim(),
    emailKey(email),
    displayName.trim(),
    new Date(),
  ]);
  return { id, email: email.trim(), displayName: displayName.trim() };
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

export function registerAuthRoutes(router: Router): void {
  router.add("POST", "/api/auth/code", async (ctx) => {
    const body = parseJson(ctx.body);
    const fields: Fields = {};
    if (!validEmail(body.email)) fields.email = FIELD.email;
    let known = false;
    if (validEmail(body.email)) {
      known = (await query("SELECT 1 FROM users WHERE email_key = $1", [emailKey(body.email)])).length > 0;
      if (!known && !validDisplayName(body.displayName)) fields.displayName = FIELD.displayName;
    }
    if (Object.keys(fields).length) throw fail.invalid(fields);
    const email = (body.email as string).trim();
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + config.codeTtlSeconds * 1000);
    await query(
      `INSERT INTO sign_in_codes (email_key, code, display_name, expires_at, attempts, used) VALUES ($1, $2, $3, $4, 0, false)
       ON CONFLICT (email_key) DO UPDATE SET code = EXCLUDED.code, display_name = EXCLUDED.display_name,
         expires_at = EXCLUDED.expires_at, attempts = 0, used = false`,
      [emailKey(email), code, known ? null : (body.displayName as string).trim(), expiresAt],
    );
    try {
      await sendMail({
        to: email,
        subject: "Your Joinery sign-in code",
        lines: [`Your Joinery sign-in code is ${code}.`, `It stops working at ${formatBusinessTime(expiresAt, config.timeZone)}.`],
      });
    } catch (error) {
      console.error(`Sign-in code email failed: ${(error as Error).message}`);
      throw fail.mail();
    }
    return json(202, { status: "sent" });
  });

  router.add("POST", "/api/auth/session", async (ctx) => {
    const body = parseJson(ctx.body);
    if (!validEmail(body.email)) throw fail.invalid({ email: FIELD.email });
    const key = emailKey(body.email);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const result = await transaction(async (db) => {
      const rows = await db.query<{ code: string; display_name: string | null; expires_at: Date; attempts: number; used: boolean }>(
        "SELECT code, display_name, expires_at, attempts, used FROM sign_in_codes WHERE email_key = $1 FOR UPDATE",
        [key],
      );
      const row = rows.rows[0];
      if (!row || row.used || row.expires_at.getTime() <= Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) return null;
      if (row.code !== code) {
        await db.query("UPDATE sign_in_codes SET attempts = attempts + 1 WHERE email_key = $1", [key]);
        return null;
      }
      await db.query("UPDATE sign_in_codes SET used = true WHERE email_key = $1", [key]);
      const user = await findOrCreateUser(db, body.email as string, row.display_name ?? "");
      const token = await createSession(db, user.id);
      return { user, token };
    });
    if (!result) throw fail.invalid({ code: FIELD.code });
    return json(200, { user: result.user }, { "Set-Cookie": sessionCookie(result.token) });
  });

  router.add("DELETE", "/api/auth/session", async (ctx) => {
    const token = ctx.cookies[SESSION_COOKIE];
    if (token) await query("DELETE FROM sessions WHERE token = $1", [token]);
    return json(204, null, { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
  });

  router.add("GET", "/api/me", async (ctx) => {
    const user = await requireUser(ctx);
    return json(200, { user });
  });
}
