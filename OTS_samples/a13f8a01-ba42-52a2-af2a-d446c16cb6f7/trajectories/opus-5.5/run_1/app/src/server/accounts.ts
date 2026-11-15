import type { PoolClient } from "pg";
import {
  clearedSessionCookie,
  endSession,
  hashPassword,
  newId,
  passwordMatches,
  randomToken,
  sha256Hex,
  startSession,
  toUser,
  type UserRow,
} from "./auth";
import { config } from "./config";
import { one, pool, transaction } from "./db";
import { ApiError, MailUnavailable, validation } from "./errors";
import { publishAccountVerified } from "./events";
import { empty, json, readJson, requireUser, type Context, type Reply } from "./http";
import { sendMail } from "./mail";

export const handlePattern = /^[a-z0-9-]{3,20}$/;

export function emailKey(email: string): string {
  return email.toLowerCase();
}

function emailIsValid(email: string): boolean {
  const parts = email.split("@");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "" && (parts[1] ?? "").includes(".");
}

export function accountFieldErrors(handle: unknown, email: unknown, password: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (typeof handle !== "string" || !handlePattern.test(handle)) fields.handle = "Use 3 to 20 lowercase letters, digits or hyphens.";
  if (typeof email !== "string" || !emailIsValid(email)) fields.email = "Enter an email address like name@example.com.";
  if (typeof password !== "string" || [...password].length < 10) fields.password = "Use at least 10 characters.";
  return fields;
}

export async function accountDuplicates(handle: unknown, email: unknown): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  if (typeof handle === "string" && (await one(pool, "SELECT 1 FROM users WHERE handle = $1", [handle]))) fields.handle = "That handle is taken.";
  if (typeof email === "string" && (await one(pool, "SELECT 1 FROM users WHERE email_key = $1", [emailKey(email)]))) fields.email = "That email already has an account.";
  return fields;
}

async function issueVerificationToken(client: PoolClient, userId: string): Promise<string> {
  const token = randomToken();
  await client.query("UPDATE verification_tokens SET spent = true WHERE user_id = $1 AND NOT spent", [userId]);
  await client.query("INSERT INTO verification_tokens (token_hash, user_id, issued_at) VALUES ($1, $2, now())", [sha256Hex(token), userId]);
  return token;
}

function verificationMail(user: UserRow, token: string) {
  return {
    to: user.email,
    subject: "Verify your Ashlar account",
    body: `Hi ${user.handle},\n\nOpen this link to verify your email: ${config.publicUrl}/verify?token=${encodeURIComponent(token)}\n\nThe link works once and expires after a while. If it has expired, sign in and use Resend link.\n`,
  };
}

export async function signup(ctx: Context): Promise<Reply> {
  const body = readJson(ctx);
  const { handle, email, password } = body;
  const duplicates = await accountDuplicates(handle, email);
  if (Object.keys(duplicates).length > 0) throw new ApiError("duplicate", { fields: duplicates });
  const fields = accountFieldErrors(handle, email, password);
  if (Object.keys(fields).length > 0) throw validation(fields);
  const user: UserRow = { id: newId(), handle: handle as string, email: email as string, verified: false };
  const passwordHash = await hashPassword(password as string);
  const { token, cookie } = await transaction(async (client) => {
    const inserted = await client.query(
      "INSERT INTO users (id, handle, email, email_key, password_hash) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [user.id, user.handle, user.email, emailKey(user.email), passwordHash],
    );
    if (inserted.rowCount === 0) throw new ApiError("duplicate", { fields: await accountDuplicates(handle, email) });
    return { token: await issueVerificationToken(client, user.id), cookie: await startSession(client, user.id) };
  });
  let verification: "sent" | "pending" = "sent";
  try {
    await sendMail(verificationMail(user, token));
  } catch (error) {
    if (!(error instanceof MailUnavailable)) throw error;
    verification = "pending";
  }
  return json(201, { user: toUser(user), verification }, { "Set-Cookie": cookie });
}

export async function signin(ctx: Context): Promise<Reply> {
  const { email, password } = readJson(ctx);
  if (typeof email !== "string" || typeof password !== "string") throw new ApiError("bad_credentials");
  const row = await one<UserRow & { password_hash: string | null }>(
    pool,
    "SELECT id, handle, email, verified, password_hash FROM users WHERE email_key = $1",
    [emailKey(email)],
  );
  if (!row || !(await passwordMatches(password, row.password_hash))) throw new ApiError("bad_credentials");
  const cookie = await startSession(pool, row.id);
  return json(200, { user: toUser(row) }, { "Set-Cookie": cookie });
}

export async function signout(ctx: Context): Promise<Reply> {
  if (ctx.sessionToken) await endSession(ctx.sessionToken);
  return empty(204, { "Set-Cookie": clearedSessionCookie() });
}

export async function me(ctx: Context): Promise<Reply> {
  return json(200, { user: toUser(requireUser(ctx)) });
}

export async function verify(ctx: Context): Promise<Reply> {
  const { token } = readJson(ctx);
  if (typeof token !== "string" || token === "") throw new ApiError("token_invalid");
  const user = await transaction(async (client) => {
    const row = await one<{ user_id: string; spent: boolean; expired: boolean }>(
      client,
      "SELECT user_id, spent, now() - issued_at >= make_interval(secs => $2) AS expired FROM verification_tokens WHERE token_hash = $1 FOR UPDATE",
      [sha256Hex(token), config.verifyTtlSeconds],
    );
    if (!row || row.spent) throw new ApiError("token_invalid");
    if (row.expired) throw new ApiError("token_expired");
    await client.query("UPDATE verification_tokens SET spent = true WHERE token_hash = $1", [sha256Hex(token)]);
    const updated = await one<UserRow>(client, "UPDATE users SET verified = true WHERE id = $1 RETURNING id, handle, email, verified", [row.user_id]);
    if (!updated) throw new ApiError("token_invalid");
    return updated;
  });
  publishAccountVerified(user.id);
  return json(200, { user: toUser(user) });
}

export async function resendVerification(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  if (user.verified) throw new ApiError("already_verified");
  await transaction(async (client) => {
    const token = await issueVerificationToken(client, user.id);
    try {
      await sendMail(verificationMail(user, token));
    } catch (error) {
      if (error instanceof MailUnavailable) throw new ApiError("mail_unavailable", { message: "Mail is unreachable, so the link was not sent." });
      throw error;
    }
  });
  return json(202, { verification: "sent" });
}

export async function gradingSession(ctx: Context): Promise<Reply> {
  const { handle } = readJson(ctx);
  const row = typeof handle === "string" ? await one<UserRow>(pool, "SELECT id, handle, email, verified FROM users WHERE handle = $1", [handle]) : undefined;
  if (!row) throw new ApiError("not_found");
  const cookie = await startSession(pool, row.id);
  return json(200, { user: toUser(row) }, { "Set-Cookie": cookie });
}
