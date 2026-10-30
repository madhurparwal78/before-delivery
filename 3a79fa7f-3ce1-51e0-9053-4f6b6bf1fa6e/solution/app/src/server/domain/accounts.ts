// Accounts (brief: Accounts, roles and sessions): signup, login, sessions, password reset and change.
import { randomBytes } from "node:crypto";
import { pool, transaction, type Tx } from "../db.ts";
import { ApiError, assertValid, invalid, type Fields } from "../errors.ts";
import { addSeconds, iso, now, SECONDS } from "../clock.ts";
import { clearCookie, cookie, SESSION_COOKIE, tokenHash, type AuthedCtx, type Ctx, type User } from "../http.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../passwords.ts";
import { mergeGuestCart } from "./cart.ts";
import { passwordReset } from "./notices.ts";
import { normaliseEmail } from "../patterns.ts";

const RESET_SENT = "If an account exists for that email, a reset link is on its way.";
/** Compared against when no account matches, so a wrong email costs the same as a wrong password. */
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));

async function startSession(tx: Tx, ctx: Ctx, userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await tx.query("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)", [tokenHash(token), userId, now()]);
  ctx.setCookie(cookie(SESSION_COOKIE, token));
}

export async function signup(ctx: Ctx): Promise<User> {
  const email = normaliseEmail(ctx.body.email);
  const fields: Fields = {};
  if (!email) fields.email = "Enter a valid email.";
  const weak = passwordProblem(ctx.body.password);
  if (weak) fields.password = weak;
  assertValid(fields);
  const hash = await hashPassword(ctx.body.password as string);
  return transaction(async (tx) => {
    const { rows } = await tx.query<User>(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES ($1, $2, 'customer', $3) ON CONFLICT (email) DO NOTHING RETURNING id, email, role",
      [email, hash, now()],
    );
    const user = rows[0];
    if (!user) throw new ApiError("email_taken");
    await startSession(tx, ctx, user.id);
    await mergeGuestCart(tx, ctx, user.id);
    return user;
  });
}

export async function login(ctx: Ctx): Promise<User> {
  const email = typeof ctx.body.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
  const password = typeof ctx.body.password === "string" ? ctx.body.password : "";
  const { rows } = await pool.query<User & { password_hash: string }>("SELECT id, email, role, password_hash FROM users WHERE email = $1", [email]);
  const found = rows[0];
  const matches = await verifyPassword(password, found?.password_hash ?? (await DUMMY_HASH));
  if (!found || !matches) throw new ApiError("invalid_credentials");
  return transaction(async (tx) => {
    await startSession(tx, ctx, found.id);
    await mergeGuestCart(tx, ctx, found.id);
    return { id: found.id, email: found.email, role: found.role };
  });
}

export async function logout(ctx: AuthedCtx): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [ctx.sessionHash]);
  ctx.setCookie(clearCookie(SESSION_COOKIE));
}

export async function me(ctx: AuthedCtx): Promise<{ user: User; demo_credit: { amount_cents: number; expires_at: string; used: boolean } | null }> {
  const { rows } = await pool.query<{ amount_cents: number; expires_at: Date; used_order_number: string | null }>(
    "SELECT amount_cents, expires_at, used_order_number FROM demo_credits WHERE user_id = $1",
    [ctx.user.id],
  );
  const credit = rows[0];
  return {
    user: ctx.user,
    demo_credit: credit ? { amount_cents: credit.amount_cents, expires_at: iso(credit.expires_at), used: credit.used_order_number !== null } : null,
  };
}

/** Always the same answer; queues the reset notice only for an existing account. */
export async function requestReset(body: Record<string, unknown>): Promise<{ message: string }> {
  const email = normaliseEmail(body.email);
  if (email) {
    await transaction(async (tx) => {
      const { rows } = await tx.query<{ id: number }>("SELECT id FROM users WHERE email = $1 FOR UPDATE", [email]);
      const user = rows[0];
      if (!user) return;
      await tx.query("UPDATE reset_tokens SET invalidated = true WHERE user_id = $1 AND used_at IS NULL", [user.id]);
      const token = randomBytes(32).toString("base64url");
      const inserted = await tx.query<{ id: number }>(
        "INSERT INTO reset_tokens (user_id, token_hash, mail_token, issued_at) VALUES ($1, $2, $3, $4) RETURNING id",
        [user.id, tokenHash(token), token, now()],
      );
      await passwordReset(tx, email, inserted.rows[0]!.id);
    });
  }
  return { message: RESET_SENT };
}

export async function confirmReset(body: Record<string, unknown>): Promise<{ message: string }> {
  const weak = passwordProblem(body.password);
  if (weak) throw invalid({ password: weak });
  const hash = await hashPassword(body.password as string);
  return transaction(async (tx) => {
    const token = typeof body.token === "string" ? body.token : "";
    const { rows } = await tx.query<{ id: number; user_id: number; issued_at: Date }>(
      "SELECT id, user_id, issued_at FROM reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND NOT invalidated FOR UPDATE",
      [tokenHash(token)],
    );
    const found = rows[0];
    if (!found || !(now() < addSeconds(found.issued_at, SECONDS.resetValid))) throw new ApiError("invalid_token");
    await tx.query("UPDATE reset_tokens SET used_at = $2 WHERE id = $1", [found.id, now()]);
    await tx.query("UPDATE users SET password_hash = $2 WHERE id = $1", [found.user_id, hash]);
    await tx.query("DELETE FROM sessions WHERE user_id = $1", [found.user_id]);
    return { message: "Your password has been reset." };
  });
}

export async function changePassword(ctx: AuthedCtx): Promise<void> {
  const { rows } = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [ctx.user.id]);
  const fields: Fields = {};
  const current = typeof ctx.body.current_password === "string" ? ctx.body.current_password : "";
  if (!(await verifyPassword(current, rows[0]?.password_hash ?? (await DUMMY_HASH)))) fields.current_password = "Your current password is incorrect.";
  const weak = passwordProblem(ctx.body.new_password);
  if (weak) fields.new_password = weak;
  assertValid(fields);
  const hash = await hashPassword(ctx.body.new_password as string);
  await transaction(async (tx) => {
    await tx.query("UPDATE users SET password_hash = $2 WHERE id = $1", [ctx.user.id, hash]);
    await tx.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [ctx.user.id, ctx.sessionHash]);
  });
}
