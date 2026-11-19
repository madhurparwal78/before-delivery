import type { JsonObject, JsonValue } from "../../shared/json.js";
import { MAX_CODE_ATTEMPTS, endSession, hashPassword, newCode, passwordMatches, requireUser, sessionCookie, startSession, userJson } from "../auth.js";
import { db } from "../db.js";
import { fail } from "../errors.js";
import { route } from "../http.js";
import { sendMail } from "../mail.js";

/** Sign-up with an emailed code, sign-in and sessions. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalEmail = (value: JsonValue | undefined): string | null => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && EMAIL.test(email) ? email : null;
};

async function mailCode(email: string): Promise<void> {
  const code = newCode();
  await db.query(
    "INSERT INTO confirmation_codes (email, code, attempts) VALUES ($1, $2, 0) ON CONFLICT (email) DO UPDATE SET code = $2, attempts = 0",
    [email, code],
  );
  await sendMail(email, "Your Jarful code", `Your code is ${code}\n`).catch((error: Error) => console.error("mail:", error.message));
}

route("POST", "/api/auth/signup", async (ctx) => {
  const body = ctx.object();
  const email = normalEmail(body["email"]);
  const password = body["password"];
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  if (email === null) fail("invalid_field", { field: "email" });
  if (typeof password !== "string" || password.length < 8) fail("invalid_field", { field: "password" });
  if (name.length < 1 || name.length > 80) fail("invalid_field", { field: "name" });
  const existing = await db.query<{ confirmed: boolean }>("SELECT confirmed FROM users WHERE email = $1", [email]);
  if (existing.rows[0]?.confirmed) fail("email_taken");
  const hash = await hashPassword(password);
  await db.query(
    "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET name = $2, password_hash = $3 WHERE NOT users.confirmed",
    [email, name, hash],
  );
  await mailCode(email);
  return { status: 201, body: { status: "code_sent" } };
});

route("POST", "/api/auth/confirm", async (ctx) => {
  const body = ctx.object();
  const email = normalEmail(body["email"]);
  const code = body["code"];
  const row = email === null ? undefined : (await db.query<{ code: string; attempts: number }>("SELECT code, attempts FROM confirmation_codes WHERE email = $1", [email])).rows[0];
  if (email === null || !row || row.attempts >= MAX_CODE_ATTEMPTS) return fail("invalid_code");
  if (code !== row.code) {
    await db.query("UPDATE confirmation_codes SET attempts = attempts + 1 WHERE email = $1", [email]);
    return fail("invalid_code");
  }
  const used = await db.query("DELETE FROM confirmation_codes WHERE email = $1 AND code = $2", [email, row.code]);
  if (used.rowCount === 0) return fail("invalid_code");
  const confirmed = await db.query<{ id: string; email: string; name: string }>("UPDATE users SET confirmed = true WHERE email = $1 RETURNING id, email, name", [email]);
  const user = confirmed.rows[0] ?? fail("invalid_code");
  const token = await startSession(user.id);
  return { status: 200, body: { user: userJson(user) }, headers: { "set-cookie": sessionCookie(token) } };
});

route("POST", "/api/auth/resend", async (ctx) => {
  const email = normalEmail(ctx.object()["email"]);
  if (email !== null) {
    const pending = await db.query("SELECT 1 FROM users WHERE email = $1 AND NOT confirmed", [email]);
    if (pending.rowCount) await mailCode(email);
  }
  return { status: 202, body: { status: "code_sent" } };
});

route("POST", "/api/auth/signin", async (ctx) => {
  const body = ctx.object();
  const email = normalEmail(body["email"]);
  const password = typeof body["password"] === "string" ? body["password"] : "";
  const row = email === null ? undefined : (await db.query<{ id: string; email: string; name: string; password_hash: string; confirmed: boolean }>("SELECT id, email, name, password_hash, confirmed FROM users WHERE email = $1", [email])).rows[0];
  if (!(await passwordMatches(password, row?.password_hash ?? null)) || !row) return fail("invalid_credentials");
  if (!row.confirmed) return fail("not_confirmed");
  const token = await startSession(row.id);
  return { status: 200, body: { user: userJson(row) }, headers: { "set-cookie": sessionCookie(token) } };
});

route("POST", "/api/auth/signout", async (ctx) => {
  await endSession(ctx);
  return { status: 204, headers: { "set-cookie": sessionCookie(null) } };
});

route("GET", "/api/me", async (ctx) => ({ status: 200, body: { user: userJson(await requireUser(ctx)) } satisfies JsonObject }));
