import type { Pool, PoolClient } from "pg";
import type { Me } from "../../shared/domain.js";
import { hueFor } from "../../shared/domain.js";
import { hashPassword, randomToken, verifyPassword } from "../auth.js";
import { sendMail, type MailKind } from "../mail.js";
import { ApiError, err, FIELD_MESSAGES } from "../http.js";
import { normalizeEmail, normalizeHandle, validPassword } from "../validate.js";
import { createSoloParty } from "../db/users.js";

const LINK_LIFETIME_MS = 30 * 60 * 1000;

export type LinkKind = "verification" | "reset";

export type MailSender = {
  send: (kind: MailKind, to: string, link: string) => Promise<void>;
};

export function createMailSender(host: string, port: number): MailSender {
  return {
    send: async (kind, to, link) => {
      await sendMail(host, port, kind, to, link);
    }
  };
}

export function linkUrl(baseUrl: string, kind: LinkKind, token: string): string {
  const page = kind === "verification" ? "verify" : "reset-password";
  return `${baseUrl}/${page}?token=${encodeURIComponent(token)}`;
}

/** Issues a single-use link of a kind, invalidating every earlier unused one. */
export async function issueLink(
  client: PoolClient,
  userId: number,
  kind: LinkKind,
  now: Date
): Promise<string> {
  await client.query("UPDATE tokens SET used_at = $1 WHERE user_id = $2 AND kind = $3 AND used_at IS NULL", [
    now,
    userId,
    kind
  ]);
  const token = randomToken();
  await client.query("INSERT INTO tokens (user_id, kind, token, sent_at) VALUES ($1, $2, $3, $4)", [
    userId,
    kind,
    token,
    now
  ]);
  return token;
}

export type LinkResult = "expired" | "invalid";

/** Consumes a single-use link, judged on the server process's own clock. */
export async function consumeLink(
  client: PoolClient,
  kind: LinkKind,
  rawToken: string,
  now: Date
): Promise<{ userId: number } | LinkResult> {
  const found = await client.query<{ id: number; user_id: number; sent_at: Date; used_at: Date | null }>(
    "SELECT id, user_id, sent_at, used_at FROM tokens WHERE kind = $1 AND token = $2",
    [kind, rawToken]
  );
  const row = found.rows[0];
  if (!row) return "invalid";
  if (row.used_at) return "invalid";
  const expiresAt = row.sent_at.getTime() + LINK_LIFETIME_MS;
  if (now.getTime() > expiresAt) return "expired";
  const used = await client.query("UPDATE tokens SET used_at = $1 WHERE id = $2 AND used_at IS NULL RETURNING id", [
    now,
    row.id
  ]);
  if (!used.rows[0]) return "invalid";
  return { userId: row.user_id };
}

export async function createSession(client: PoolClient, userId: number): Promise<string> {
  const token = randomToken();
  await client.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
  return token;
}

export async function destroySessions(client: PoolClient, userId: number): Promise<void> {
  await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

export function meOf(row: { id: number; handle: string; email: string; email_verified: boolean }): Me {
  return {
    id: row.id,
    handle: row.handle,
    hue: hueFor(row.id),
    email: row.email,
    emailVerified: row.email_verified
  };
}

export async function signup(
  pool: Pool,
  params: { email: string; handle: string; password: string; baseUrl: string; mail: MailSender; now: Date }
): Promise<{ user: Me; verificationEmail: "sent" | "failed"; sessionToken: string }> {
  const email = normalizeEmail(params.email);
  const handle = normalizeHandle(params.handle);
  if (!email) throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { email: FIELD_MESSAGES.emailInvalid });
  if (!handle) throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { handle: FIELD_MESSAGES.handleInvalid });
  if (!validPassword(params.password)) throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { password: FIELD_MESSAGES.passwordInvalid });

  const passwordHash = await hashPassword(params.password);
  const client = await pool.connect();
  let userRow: { id: number; handle: string; email: string; email_verified: boolean } | undefined;
  try {
    await client.query("BEGIN");
    const emailTaken = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (emailTaken.rows[0]) throw new ApiError(409, "email_taken", "That email already has an account.");
    const handleTaken = await client.query("SELECT 1 FROM users WHERE handle_lower = $1", [handle]);
    if (handleTaken.rows[0]) throw new ApiError(409, "handle_taken", "That handle is taken.");
    const inserted = await client.query<{ id: number; handle: string; email: string; email_verified: boolean }>(
      "INSERT INTO users (handle, handle_lower, email, password_hash, email_verified) VALUES ($1, $2, $3, $4, FALSE) RETURNING id, handle, email, email_verified",
      [handle, handle.toLowerCase(), email, passwordHash]
    );
    userRow = inserted.rows[0];
    if (!userRow) throw err("server_error");
    await createSoloParty(client, userRow.id);
    const token = await issueLink(client, userRow.id, "verification", params.now);
    await client.query("COMMIT");

    let verification: "sent" | "failed" = "sent";
    try {
      await params.mail.send("verification", email, linkUrl(params.baseUrl, "verification", token));
    } catch {
      verification = "failed";
      await client.query("UPDATE tokens SET used_at = $1 WHERE token = $2", [new Date(), token]);
    }
    const sessionToken = await createSession(client, userRow.id);
    return { user: meOf(userRow), verificationEmail: verification, sessionToken };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function verifyToken(
  pool: Pool,
  token: string,
  now: Date
): Promise<Me> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await consumeLink(client, "verification", token, now);
    if (result === "expired") throw new ApiError(410, "link_expired", "This link has expired. Request a new one.");
    if (result === "invalid") throw new ApiError(410, "link_invalid", "This link has already been used or replaced by a newer one.");
    const updated = await client.query<{ id: number; handle: string; email: string; email_verified: boolean }>(
      "UPDATE users SET email_verified = TRUE WHERE id = $1 RETURNING id, handle, email, email_verified",
      [result.userId]
    );
    await client.query("COMMIT");
    const row = updated.rows[0];
    if (!row) throw err("server_error");
    return meOf(row);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function resendVerification(
  pool: Pool,
  userId: number,
  params: { baseUrl: string; mail: MailSender; now: Date }
): Promise<{ email: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query<{ id: number; handle: string; email: string; email_verified: boolean }>(
      "SELECT id, handle, email, email_verified FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );
    const row = user.rows[0];
    if (!row) throw err("unauthenticated");
    if (row.email_verified) throw new ApiError(409, "already_verified", "Your email is already verified.");
    const token = await issueLink(client, userId, "verification", params.now);
    await client.query("COMMIT");

    try {
      await params.mail.send("verification", row.email, linkUrl(params.baseUrl, "verification", token));
    } catch {
      await pool.query("UPDATE tokens SET used_at = $1 WHERE token = $2", [new Date(), token]);
      throw err("mail_unavailable");
    }
    return { email: row.email };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function requestPasswordReset(
  pool: Pool,
  rawEmail: string,
  params: { baseUrl: string; mail: MailSender; now: Date }
): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { email: FIELD_MESSAGES.emailInvalid });
  const found = await pool.query<{ id: number }>("SELECT id FROM users WHERE email = $1", [email]);
  const user = found.rows[0];
  if (!user) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const token = await issueLink(client, user.id, "reset", params.now);
    await client.query("COMMIT");
    try {
      await params.mail.send("reset", email, linkUrl(params.baseUrl, "reset", token));
    } catch {
      await pool.query("UPDATE tokens SET used_at = $1 WHERE token = $2", [new Date(), token]);
      throw err("mail_unavailable");
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function confirmPasswordReset(
  pool: Pool,
  token: string,
  password: string,
  now: Date
): Promise<void> {
  if (!validPassword(password)) throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { password: FIELD_MESSAGES.passwordInvalid });
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await consumeLink(client, "reset", token, now);
    if (result === "expired") throw new ApiError(410, "link_expired", "This link has expired. Request a new one.");
    if (result === "invalid") throw new ApiError(410, "link_invalid", "This link has already been used or replaced by a newer one.");
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, result.userId]);
    await client.query("DELETE FROM sessions WHERE user_id = $1", [result.userId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function login(pool: Pool, rawEmail: string, password: string): Promise<{ user: Me; sessionToken: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
  const found = await pool.query<{ id: number; handle: string; email: string; email_verified: boolean; password_hash: string }>(
    "SELECT id, handle, email, email_verified, password_hash FROM users WHERE email = $1",
    [email]
  );
  const row = found.rows[0];
  if (!row) throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
  const client = await pool.connect();
  let sessionToken: string;
  try {
    sessionToken = await createSession(client, row.id);
  } finally {
    client.release();
  }
  return { user: meOf(row), sessionToken };
}
