import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { SessionUser, TeamRole } from "../shared/api";
import { settings } from "./config";
import { pool, query, queryOne } from "./db";
import type { Db } from "./db";
import { ApiError, mailUnavailable, notFound, validationFailed } from "./errors";
import { defineRoute, reply } from "./http";
import type { Route } from "./http";
import { MailUnavailable, sendMail } from "./mail";
import { asRecord } from "../shared/records";
import {
  clearedSessionCookie, closeSession, hashToken, newId, newToken, openSession, sessionCookie, sessionToken, toSessionUser,
} from "./session";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
const UNIQUE_VIOLATION = "23505";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("base64")}$${(await scryptAsync(password, salt, KEY_LENGTH)).toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split("$") as [string, string];
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), KEY_LENGTH);
  return timingSafeEqual(Buffer.from(key, "base64"), actual);
}

/** Creates a verification link for a new account and emails it. */
async function sendVerification(db: Db, userId: string, email: string): Promise<void> {
  const token = newToken();
  await db.query(
    "INSERT INTO verification_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
    [hashToken(token), userId, settings.verifyTtlSeconds],
  );
  try {
    await sendMail(email, "Confirm your Wringbench account", `Confirm your Wringbench account:\n\n${settings.publicUrl}/verify/${token}\n`);
  } catch (error) {
    if (error instanceof MailUnavailable) throw mailUnavailable();
    throw error;
  }
}

interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  verified: boolean;
}

async function createUser(
  db: Db, input: { displayName: string; email: string; passwordHash: string; verified: boolean },
): Promise<SessionUser> {
  const row = await queryOne<UserRecord>(
    db,
    "INSERT INTO users (id, email, display_name, password_hash, verified) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [newId("u"), input.email, input.displayName, input.passwordHash, input.verified],
  );
  return toSessionUser(row as UserRecord);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SignUp {
  displayName: string;
  email: string;
  password: string;
}

function parseSignUp(raw: unknown): SignUp {
  const body = asRecord(raw);
  const fields: Record<string, string> = {};
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (displayName.length < 1 || displayName.length > 40) fields.displayName = "Display name needs 1 to 40 characters.";
  if (!EMAIL_PATTERN.test(email)) fields.email = "Enter a valid email address.";
  if (password.length < 10) fields.password = "Password needs at least 10 characters.";
  if (Object.keys(fields).length) throw validationFailed(fields);
  return { displayName, email, password };
}

async function teamsOf(db: Db, userId: string): Promise<TeamRole[]> {
  return query<TeamRole>(
    db,
    `SELECT t.id, t.name, m.role FROM team_members m JOIN teams t ON t.id = m.team_id
     WHERE m.user_id = $1 ORDER BY t.created_at, t.id`,
    [userId],
  );
}

export const authRoutes: Route[] = [
  defineRoute<undefined, SignUp>({
    method: "POST", path: "/api/auth/signup", access: "public", body: "json",
    check: async (_, __, body) => {
      const email = asRecord(body).email;
      if (typeof email === "string" && (await queryOne(pool, "SELECT 1 FROM users WHERE lower(email) = $1", [email.trim().toLowerCase()]))) {
        throw new ApiError(409, "email_taken", "An account with this email already exists.");
      }
    },
    validate: parseSignUp,
    run: async (ctx, _, signUp) => {
      const db = await ctx.transaction();
      const passwordHash = await hashPassword(signUp.password);
      const user = await createUser(db, { displayName: signUp.displayName, email: signUp.email, passwordHash, verified: false }).catch(
        (error: unknown) => {
          if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new ApiError(409, "email_taken", "An account with this email already exists.");
          throw error;
        },
      );
      await sendVerification(db, user.id, user.email);
      return reply(201, { user });
    },
  }),
  defineRoute<undefined, string>({
    method: "POST", path: "/api/auth/verify", access: "public", body: "json",
    validate: (body) => {
      const token = asRecord(body).token;
      if (typeof token !== "string" || token === "") throw validationFailed({ token: "token is required." });
      return token;
    },
    run: async (ctx, _, token) => {
      const db = await ctx.transaction();
      const spent = await queryOne<{ user_id: string }>(
        db,
        "UPDATE verification_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id",
        [hashToken(token)],
      );
      if (!spent) throw notFound();
      const row = await queryOne<UserRecord>(db, "UPDATE users SET verified = true WHERE id = $1 RETURNING *", [spent.user_id]);
      return reply(200, { user: toSessionUser(row as UserRecord) });
    },
  }),
  defineRoute<undefined, { email: string; password: string }>({
    method: "POST", path: "/api/auth/signin", access: "public", body: "json",
    validate: (body) => {
      const { email, password } = asRecord(body);
      if (typeof email !== "string" || typeof password !== "string") {
        throw validationFailed({ email: "Email and password are required." });
      }
      return { email: email.trim().toLowerCase(), password };
    },
    run: async (_, __, { email, password }) => {
      const row = await queryOne<UserRecord>(pool, "SELECT * FROM users WHERE lower(email) = $1", [email]);
      const known = row !== null && (await passwordMatches(password, row.password_hash));
      if (!row || !known) throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
      if (!row.verified) throw new ApiError(403, "email_unverified", "Confirm your email first. We sent you a link.");
      const token = await openSession(pool, row.id);
      return reply(200, { user: toSessionUser(row) }, { "set-cookie": sessionCookie(token) });
    },
  }),
  defineRoute({
    method: "POST", path: "/api/auth/signout", access: "public",
    run: async (ctx) => {
      const token = sessionToken(ctx.req);
      if (token) await closeSession(token);
      return reply(204, undefined, { "set-cookie": clearedSessionCookie });
    },
  }),
  defineRoute({
    method: "GET", path: "/api/me", access: "session",
    run: async (ctx) => reply(200, { user: ctx.me(), teams: await teamsOf(pool, ctx.me().id) }),
  }),
];
