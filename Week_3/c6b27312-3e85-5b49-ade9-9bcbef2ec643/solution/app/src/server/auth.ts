// Accounts: sign-up with a mailed verification link, sign-in, sessions and the landing rule.
import { SESSION_COOKIE } from "./cookies";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { DISPLAY_NAME_MAX, boundedMessage, boundedText, foldEmail, graphemeCount, normalizeText } from "../shared/text";
import { config } from "./config";
import { db, transaction, type Queries } from "./db";
import { ApiError, MailUnavailable, invalid, unauthenticated } from "./errors";
import type { Ctx } from "./http";
import { get, post, type Route } from "./route";
import { clearedSessionCookie, sessionCookie } from "./cookies";
import { newId, randomToken } from "./ids";
import { sendMail } from "./mail";
import { jsonReply, noContent, redirect } from "./reply";

export interface User {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  verified: boolean;
  password_hash: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 10;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value);
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = "", key = ""] = stored.split(":");
  const expected = Buffer.from(key, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, displayName: row.display_name, verified: row.verified };
}

export async function sessionUser(token: string): Promise<User | null> {
  const row = await db.row<UserRow>(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [sha256(token)],
  );
  return row ? toUser(row) : null;
}

export async function createSession(queries: Queries, userId: string): Promise<string> {
  const token = randomToken();
  await queries.run("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [sha256(token), userId]);
  return token;
}

interface NewUser {
  email: string;
  password: string;
  displayName: string;
  verified: boolean;
  createdAt: Date;
}

/** Inserts an account; the unique folded email makes a duplicate a 23505. */
export async function insertUser(queries: Queries, fields: NewUser): Promise<string> {
  const id = newId();
  await queries.run(
    "INSERT INTO users (id, email, email_fold, display_name, password_hash, verified, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, fields.email, foldEmail(fields.email), normalizeText(fields.displayName), await hashPassword(fields.password), fields.verified, fields.createdAt],
  );
  return id;
}

const emailTaken = () => new ApiError(409, "email_taken", "An account with this email already exists.");

/** Where a return address lands: it must be a single-slash path, otherwise the home page. */
function landing(next: unknown, fallback: string): string {
  if (next === undefined || next === null || next === "") return fallback;
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/";
}

async function signUp(ctx: Ctx) {
  const body = ctx.json();
  const { email, password, displayName } = body;
  if (isEmail(email) && (await db.row("SELECT 1 FROM users WHERE email_fold = $1", [foldEmail(email)]))) throw emailTaken();
  ctx.checkNumbers();
  const errors: Record<string, string> = {};
  if (!isEmail(email)) errors.email = "Enter a valid email address.";
  if (typeof password !== "string" || graphemeCount(password) < PASSWORD_MIN) errors.password = `Use at least ${PASSWORD_MIN} characters.`;
  const name = boundedText(displayName, DISPLAY_NAME_MAX);
  if (name === null) errors.displayName = boundedMessage(DISPLAY_NAME_MAX);
  if (!isEmail(email) || typeof password !== "string" || name === null || Object.keys(errors).length > 0) throw invalid(errors);

  const token = randomToken();
  try {
    await transaction(async (tx) => {
      const id = await insertUser(tx, { email, password, displayName: name, verified: false, createdAt: new Date() });
      await tx.run("INSERT INTO verifications (token_hash, user_id) VALUES ($1, $2)", [sha256(token), id]);
      const link = `${config.publicUrl}/auth/verify?token=${token}&next=${encodeURIComponent(landing(body.next, "/"))}`;
      await sendMail(email, "Confirm your Tinework account", `Confirm your email address to finish creating your Tinework account:\n${link}\n`);
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw emailTaken();
    if (error instanceof MailUnavailable) {
      throw new ApiError(503, "mail_unavailable", "We could not send the email right now. Try again in a minute.");
    }
    throw error;
  }
  return jsonReply(201, { status: "verification_sent" });
}

async function verify(ctx: Ctx) {
  const token = ctx.url.searchParams.get("token") ?? "";
  const used = await db.row<{ user_id: string; fresh: boolean }>(
    "DELETE FROM verifications WHERE token_hash = $1 RETURNING user_id, now() - created_at < make_interval(secs => $2) AS fresh",
    [sha256(token), config.verifyTokenTtlSeconds],
  );
  if (!used?.fresh) return redirect("/signin?expired=1");
  await db.run("UPDATE users SET verified = true WHERE id = $1", [used.user_id]);
  const session = await createSession(db, used.user_id);
  ctx.responseCookies.push(sessionCookie(session));
  return redirect(landing(ctx.url.searchParams.get("next"), "/"));
}

async function signIn(ctx: Ctx) {
  ctx.checkNumbers();
  const { email, password, next } = ctx.json();
  const row = isEmail(email) ? await db.row<UserRow>("SELECT * FROM users WHERE email_fold = $1", [foldEmail(email)]) : undefined;
  if (!row || typeof password !== "string" || !(await passwordMatches(password, row.password_hash))) {
    throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
  }
  if (!row.verified) throw new ApiError(403, "unverified", "Confirm your email first; we sent you a link.");
  const session = await createSession(db, row.id);
  ctx.responseCookies.push(sessionCookie(session));
  return jsonReply(200, { id: row.id, email: row.email, displayName: row.display_name, landing: landing(next, "/dashboard") });
}

async function signOut(ctx: Ctx) {
  const token = ctx.cookies.get(SESSION_COOKIE);
  if (token) await db.run("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  ctx.responseCookies.push(clearedSessionCookie);
  return noContent;
}

async function me(ctx: Ctx) {
  const user = await ctx.user();
  if (!user) throw unauthenticated();
  return jsonReply(200, { id: user.id, email: user.email, displayName: user.displayName });
}

export const authRoutes: Route[] = [
  post("/api/auth/signup", signUp),
  get("/auth/verify", verify),
  post("/api/auth/signin", signIn),
  post("/api/auth/signout", signOut),
  get("/api/me", me),
];
