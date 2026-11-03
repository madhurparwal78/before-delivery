// Accounts, sessions and the single-use verification and reset links.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { LOCK, lockKey, one, type Queryable, query, transaction } from "./db.js";
import { ApiError, FIELD_COPY, fieldError } from "./errors.js";
import { hashToken, route, SESSION_COOKIE } from "./http.js";
import { MailUnavailable, probeMail, sendMail } from "./mail.js";
import { startSoloParty } from "./party.js";
import { toMe } from "./users.js";
import { HANDLE_PATTERN, LINK_LIFETIME_MS } from "../shared/rules.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const KEY_LENGTH = 32;

type LinkKind = "verify" | "reset";

const LINKS: Record<LinkKind, { subject: string; path: string; lead: string }> = {
  verify: { subject: "Verify your Pratfall Cup email", path: "/verify", lead: "Open this link to verify your Pratfall Cup email:" },
  reset: { subject: "Reset your Pratfall Cup password", path: "/reset-password", lead: "Open this link to choose a new Pratfall Cup password:" },
};

let linkBase = "";

export function configureLinks(base: string): void {
  linkBase = base;
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  const parts = email.split("@");
  const [local, domain] = parts;
  if (parts.length !== 2 || local === undefined || domain === undefined || email.length > 254 || /\s/.test(email)) return null;
  const labels = domain.split(".");
  if (local === "" || labels.length < 2 || labels.some((label) => label === "")) return null;
  return email;
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || salt === undefined || key === undefined) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

async function openSession(userId: number, on?: Queryable): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)", [hashToken(token), userId, new Date()], on);
  return token;
}

// Sends a fresh link; only once the mail is accepted does it become the one usable link of its kind.
// The swap runs under a per-account lock, so concurrent requests on any process leave exactly one link active.
async function issueLink(userId: number, email: string, kind: LinkKind): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const link = await one<{ id: number }>(
    "INSERT INTO link_tokens (user_id, kind, token_hash, sent_at, status) VALUES ($1, $2, $3, $4, 'sending') RETURNING id",
    [userId, kind, hashToken(token), new Date()]);
  if (link === undefined) throw new Error("link not stored");
  const spec = LINKS[kind];
  try {
    await sendMail({
      to: email,
      subject: spec.subject,
      text: `${spec.lead}\n${linkBase}${spec.path}?token=${token}\n\nThis link expires in 30 minutes.\n`,
    });
  } catch (error) {
    await query("UPDATE link_tokens SET status = 'failed' WHERE id = $1", [link.id]);
    throw error;
  }
  await transaction(async (client) => {
    await lockKey(client, LOCK.links, userId);
    await query("UPDATE link_tokens SET status = 'replaced' WHERE user_id = $1 AND kind = $2 AND status = 'active'", [userId, kind], client);
    await query("UPDATE link_tokens SET status = 'active' WHERE id = $1", [link.id], client);
  });
}

// Spends a link: unknown, used and replaced links are invalid; live ones expire by this process's own clock.
async function spendLink(token: unknown, kind: LinkKind, on: Queryable): Promise<number> {
  if (typeof token !== "string" || token === "") throw new ApiError("link_invalid");
  const link = await one<{ id: number; user_id: number; sent_at: Date }>(
    "SELECT id, user_id, sent_at FROM link_tokens WHERE token_hash = $1 AND kind = $2 AND status = 'active' FOR UPDATE",
    [hashToken(token), kind], on);
  if (link === undefined) throw new ApiError("link_invalid");
  if (Date.now() - link.sent_at.getTime() > LINK_LIFETIME_MS) throw new ApiError("link_expired");
  await query("UPDATE link_tokens SET status = 'used' WHERE id = $1", [link.id], on);
  return link.user_id;
}

async function meById(userId: number, on?: Queryable): Promise<ReturnType<typeof toMe>> {
  const row = await one("SELECT id, handle, email, email_verified FROM users WHERE id = $1", [userId], on);
  if (row === undefined) throw new ApiError("user_not_found");
  return toMe(row);
}

route("POST", "/api/auth/signup", "public", async ({ body }) => {
  const email = normaliseEmail(body["email"]);
  const handle = typeof body["handle"] === "string" ? body["handle"] : "";
  const password = body["password"];
  if (email === null || !HANDLE_PATTERN.test(handle) || !validPassword(password)) {
    const fields: Record<string, string> = {};
    if (email === null) fields["email"] = FIELD_COPY.email;
    if (!HANDLE_PATTERN.test(handle)) fields["handle"] = FIELD_COPY.handle;
    if (!validPassword(password)) fields["password"] = FIELD_COPY.password;
    throw fieldError(fields);
  }
  const passwordHash = await hashPassword(password);
  const created = await transaction(async (client) => {
    await lockKey(client, LOCK.signup, 0);
    if ((await one("SELECT 1 FROM users WHERE email = $1", [email], client)) !== undefined) throw new ApiError("email_taken");
    if ((await one("SELECT 1 FROM users WHERE lower(handle) = $1", [handle], client)) !== undefined) throw new ApiError("handle_taken");
    const user = await one<{ id: number }>(
      "INSERT INTO users (email, handle, password_hash, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [email, handle, passwordHash, new Date()], client);
    if (user === undefined) throw new Error("user not stored");
    await startSoloParty(client, user.id);
    return { id: user.id, token: await openSession(user.id, client) };
  });
  let verificationEmail: "sent" | "failed" = "sent";
  try {
    await issueLink(created.id, email, "verify");
  } catch (error) {
    if (!(error instanceof MailUnavailable)) throw error;
    verificationEmail = "failed";
  }
  return {
    status: 201,
    body: { user: await meById(created.id), verificationEmail },
    headers: { "Set-Cookie": sessionCookie(created.token) },
  };
});

route("POST", "/api/auth/verify", "public", async ({ body }) => {
  const userId = await transaction(async (client) => {
    const owner = await spendLink(body["token"], "verify", client);
    await query("UPDATE users SET email_verified = TRUE WHERE id = $1", [owner], client);
    return owner;
  });
  return { status: 200, body: { user: await meById(userId) } };
});

route("POST", "/api/auth/verification/resend", "session", async ({ me }) => {
  if (me.emailVerified) throw new ApiError("already_verified");
  try {
    await issueLink(me.id, me.email, "verify");
  } catch (error) {
    if (error instanceof MailUnavailable) throw new ApiError("mail_unavailable");
    throw error;
  }
  return { status: 202, body: { verificationEmail: "sent" } };
});

route("POST", "/api/auth/login", "public", async ({ body }) => {
  const email = normaliseEmail(body["email"]);
  const password = body["password"];
  const row = email === null ? undefined : await one<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = $1", [email]);
  if (row === undefined || typeof password !== "string" || !(await passwordMatches(password, row.password_hash))) {
    throw new ApiError("invalid_credentials");
  }
  const token = await openSession(row.id);
  return { status: 200, body: { user: await meById(row.id) }, headers: { "Set-Cookie": sessionCookie(token) } };
});

route("POST", "/api/auth/logout", "public", async ({ sessionHash }) => {
  if (sessionHash !== null) await query("DELETE FROM sessions WHERE token_hash = $1", [sessionHash]);
  return { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
});

route("GET", "/api/me", "session", async ({ me }) => ({ status: 200, body: { user: me } }));

route("POST", "/api/auth/password-reset", "public", async ({ body }) => {
  const email = normaliseEmail(body["email"]);
  if (email === null) throw fieldError({ email: FIELD_COPY.email });
  const account = await one<{ id: number }>("SELECT id FROM users WHERE email = $1", [email]);
  try {
    if (account === undefined) await probeMail();
    else await issueLink(account.id, email, "reset");
  } catch (error) {
    if (error instanceof MailUnavailable) throw new ApiError("mail_unavailable");
    throw error;
  }
  return { status: 202, body: { status: "accepted" } };
});

route("POST", "/api/auth/password-reset/confirm", "public", async ({ body }) => {
  const password = body["password"];
  if (!validPassword(password)) throw fieldError({ password: FIELD_COPY.password });
  const passwordHash = await hashPassword(password);
  await transaction(async (client) => {
    const owner = await spendLink(body["token"], "reset", client);
    await query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, owner], client);
    await query("DELETE FROM sessions WHERE user_id = $1", [owner], client);
  });
  return { status: 200, body: { status: "password_changed" } };
});
