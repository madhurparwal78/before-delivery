import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { newId, pool, query, tx, type Db } from "./db.ts";
import {
  formErrors,
  invalidCredentials,
  mailUnavailable,
  notFound,
  schoolExists,
  unauthenticated,
  unverified,
  verifyExpired,
} from "./errors.ts";
import { reply, route, type Ctx, type UserRow } from "./http.ts";
import { MailError, sendMail } from "./mail.ts";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"), 32);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const newToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export const MIN_PASSWORD = 10;
const COOKIE = "sid";
const LOGIN_DAYS = 30;

const EMAIL = /^[^\s@<>"',;()[\]\\]+@[^\s@<>"',;()[\]\\]+\.[^\s@<>"',;()[\]\\]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export const normaliseEmail = (value: unknown): string => (typeof value === "string" ? value.trim().toLowerCase() : "");
export const validEmail = (email: string): boolean => email.length <= 254 && EMAIL.test(email);

/** A trimmed one-line name, or null when it is empty, too long or holds control characters. */
export function cleanName(value: unknown, max = 100): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name !== "" && name.length <= max && !CONTROL.test(name) ? name : null;
}

export async function userFromCookie(cookie: (name: string) => string | undefined): Promise<UserRow | null> {
  const token = cookie(COOKIE);
  if (!token) return null;
  const rows = await query<UserRow>(
    pool,
    `SELECT u.id, u.name, u.email, u.verified, u.reduce_motion
       FROM logins l JOIN users u ON u.id = l.user_id
      WHERE l.token_hash = $1 AND l.created_at > now() - interval '${LOGIN_DAYS} days'`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function requireUser(ctx: Ctx): Promise<UserRow> {
  const user = await userFromCookie(ctx.cookie);
  if (!user) throw unauthenticated();
  ctx.user = user;
  return user;
}

export async function startLogin(db: Db, userId: string): Promise<Record<string, string>> {
  const token = newToken();
  await query(db, "INSERT INTO logins (token_hash, user_id) VALUES ($1, $2)", [hashToken(token), userId]);
  return { "Set-Cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${LOGIN_DAYS * 86400}` };
}

const link = (path: string): string => `${config.publicUrl}${path}`;

async function sendVerification(db: Db, userId: string, email: string): Promise<void> {
  const token = newToken();
  await query(db, "INSERT INTO verification_tokens (token_hash, user_id) VALUES ($1, $2)", [hashToken(token), userId]);
  try {
    await sendMail(email, "Verify your Runup Bay email", `Open this link to verify your email:\n\n${link(`/verify?token=${token}`)}\n`);
  } catch (error) {
    if (error instanceof MailError) throw mailUnavailable();
    throw error;
  }
}

interface Role {
  school: { id: string; name: string } | null;
  classes: { id: string; name: string }[];
  role: "instructor" | "student" | null;
}

async function roleOf(db: Db, userId: string): Promise<Role> {
  const schools = await query<{ id: string; name: string }>(db, "SELECT id, name FROM schools WHERE instructor_id = $1", [userId]);
  const school = schools[0] ?? null;
  const classes = school
    ? await query<{ id: string; name: string }>(db, "SELECT id, name FROM classes WHERE school_id = $1 ORDER BY created_at, id", [school.id])
    : await query<{ id: string; name: string }>(
        db,
        "SELECT c.id, c.name FROM classes c JOIN class_members m ON m.class_id = c.id WHERE m.user_id = $1 ORDER BY c.created_at, c.id",
        [userId],
      );
  return { school, classes, role: school ? "instructor" : classes.length > 0 ? "student" : null };
}

async function meOf(user: UserRow): Promise<Record<string, unknown>> {
  const role = await roleOf(pool, user.id);
  return { id: user.id, name: user.name, email: user.email, reduceMotion: user.reduce_motion, ...role };
}

/** Requires an instructor and returns their school id; anyone else is answered not found. */
export async function requireInstructor(ctx: Ctx): Promise<{ user: UserRow; schoolId: string }> {
  const user = await requireUser(ctx);
  const rows = await query<{ id: string }>(pool, "SELECT id FROM schools WHERE instructor_id = $1", [user.id]);
  const school = rows[0];
  if (!school) throw notFound();
  return { user, schoolId: school.id };
}

function validateSignup(body: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (cleanName(body.name) === null) errors.name = "Name is required.";
  if (!validEmail(normaliseEmail(body.email))) errors.email = "Enter a valid email address.";
  if (typeof body.password !== "string" || body.password.length < MIN_PASSWORD) {
    errors.password = `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  return errors;
}

export function registerAuthRoutes(): void {
  route(
    "POST",
    "/api/signup",
    async (ctx) => {
      const body = await ctx.json();
      const errors = validateSignup(body);
      if (Object.keys(errors).length > 0) throw formErrors(errors);
      const name = cleanName(body.name) ?? "";
      const email = normaliseEmail(body.email);
      const password = String(body.password);
      const hash = await hashPassword(password);
      const id = await tx(async (client) => {
        // One signup per address at a time: a racing twin waits here and then finds the account.
        await query(client, "SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
        const existing = (
          await query<{ id: string; verified: boolean; stale: boolean }>(
            client,
            `SELECT u.id, u.verified,
                    NOT EXISTS (SELECT 1 FROM verification_tokens t WHERE t.user_id = u.id
                                 AND t.created_at > now() - interval '${config.verifyTtlHours} hours') AS stale
               FROM users u WHERE lower(u.email) = $1`,
            [email],
          )
        )[0];
        // A live verification link counts as registered; only an expired one lets the address sign up again.
        if (existing && (existing.verified || !existing.stale)) throw formErrors({ email: "This email is already registered." });
        const userId = existing?.id ?? newId();
        if (!existing) {
          await query(client, "INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)", [userId, name, email, hash]);
        } else {
          await query(client, "UPDATE users SET name = $2, password_hash = $3 WHERE id = $1", [userId, name, hash]);
        }
        await sendVerification(client, userId, email);
        return userId;
      });
      return reply(201, { id });
    },
  );

  route(
    "POST",
    "/api/verify",
    async (ctx) => {
      const body = await ctx.json();
      const token = typeof body.token === "string" ? body.token : "";
      const found = (
        await query<{ user_id: string; expired: boolean }>(
          pool,
          `SELECT user_id, created_at < now() - interval '${config.verifyTtlHours} hours' AS expired
             FROM verification_tokens WHERE token_hash = $1`,
          [hashToken(token)],
        )
      )[0];
      if (!found) throw notFound();
      if (found.expired) throw verifyExpired();
      await query(pool, "UPDATE users SET verified = true WHERE id = $1", [found.user_id]);
      return { ok: true };
    },
  );

  route(
    "POST",
    "/api/session",
    async (ctx) => {
      const body = await ctx.json();
      const email = normaliseEmail(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      const row = (
        await query<{ id: string; name: string; email: string; password_hash: string; verified: boolean }>(
          pool,
          "SELECT id, name, email, password_hash, verified FROM users WHERE lower(email) = $1",
          [email],
        )
      )[0];
      if (!row || !(await checkPassword(password, row.password_hash))) throw invalidCredentials();
      if (!row.verified) throw unverified();
      return reply(200, { id: row.id, name: row.name, email: row.email }, await startLogin(pool, row.id));
    },
  );

  route(
    "DELETE",
    "/api/session",
    async (ctx) => {
      const token = ctx.cookie(COOKIE);
      if (token) await query(pool, "DELETE FROM logins WHERE token_hash = $1", [hashToken(token)]);
      return reply(204, undefined, { "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
    },
  );

  route("GET", "/api/me", async (ctx) => meOf(await requireUser(ctx)));

  route("PATCH", "/api/me", async (ctx) => {
    const user = await requireUser(ctx);
    const body = await ctx.json();
    const errors: Record<string, string> = {};
    if (body.name !== undefined && cleanName(body.name) === null) errors.name = "Name is required.";
    if (body.reduceMotion !== undefined && typeof body.reduceMotion !== "boolean") errors.reduceMotion = "Choose on or off.";
    let newHash: string | null = null;
    if (typeof body.newPassword === "string" && body.newPassword !== "") {
      const current = (await query<{ password_hash: string }>(pool, "SELECT password_hash FROM users WHERE id = $1", [user.id]))[0];
      if (typeof body.currentPassword !== "string" || !current || !(await checkPassword(body.currentPassword, current.password_hash))) {
        errors.currentPassword = "Current password is incorrect.";
      }
      if (body.newPassword.length < MIN_PASSWORD) errors.newPassword = `Password must be at least ${MIN_PASSWORD} characters.`;
      if (!errors.currentPassword && !errors.newPassword) newHash = await hashPassword(body.newPassword);
    }
    if (Object.keys(errors).length > 0) throw formErrors(errors);
    await query(
      pool,
      `UPDATE users SET name = COALESCE($2, name), reduce_motion = COALESCE($3, reduce_motion),
              password_hash = COALESCE($4, password_hash) WHERE id = $1`,
      [user.id, body.name === undefined ? null : cleanName(body.name), body.reduceMotion ?? null, newHash],
    );
    const fresh = (await query<UserRow>(pool, "SELECT id, name, email, verified, reduce_motion FROM users WHERE id = $1", [user.id]))[0];
    return meOf(fresh ?? user);
  });

  route("POST", "/api/schools", async (ctx) => {
    const user = await requireUser(ctx);
    const body = await ctx.json();
    const role = await roleOf(pool, user.id);
    if (role.school) throw schoolExists();
    if (role.role === "student") throw notFound();
    const name = cleanName(body.name);
    if (name === null) throw formErrors({ name: "School name is required." });
    const id = newId();
    const made = await query(pool, "INSERT INTO schools (id, name, instructor_id) VALUES ($1, $2, $3) ON CONFLICT (instructor_id) DO NOTHING RETURNING id", [id, name, user.id]);
    if (made.length === 0) throw schoolExists();
    return reply(201, { id, name });
  });
}
