import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";
import { M } from "../shared/messages.js";
import type { ErrorItem, PublicUser } from "../shared/types.js";
import { now } from "./clock.js";
import { one, pool, type Db } from "./db.js";
import { isEmail } from "./engine/checks.js";
import { ApiError, validationFailed } from "./errors.js";
import { json, type Ctx, type Router } from "./http.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SESSION_COOKIE = "nf_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  const candidate = await scryptAsync(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function createUser(name: string, email: string, password: string, db: Db = pool): Promise<PublicUser> {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users (id, name, email, email_lower, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, name, email, email.toLowerCase(), await hashPassword(password), now()],
  );
  return { id, name, email };
}

export async function createSession(userId: string, db: Db = pool): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)", [tokenHash(token), userId, now()]);
  return token;
}

/** The signed-in person, or null. */
export function currentUser(ctx: Ctx): Promise<PublicUser | null> {
  return sessionUser(ctx.cookies[SESSION_COOKIE]);
}

export async function sessionUser(token: string | undefined): Promise<PublicUser | null> {
  if (!token) return null;
  return one<PublicUser>(
    "SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [tokenHash(token)],
  );
}

export async function requireUser(ctx: Ctx): Promise<PublicUser> {
  const user = await currentUser(ctx);
  if (!user) throw new ApiError("SIGN_IN_REQUIRED");
  return user;
}

function startSession(ctx: Ctx, token: string): void {
  ctx.setCookie(SESSION_COOKIE, token, SESSION_MAX_AGE);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function registerAuthRoutes(router: Router): void {
  router.add("POST", "/api/account", async (ctx) => {
    const body = ctx.json();
    const name = str(body.name).trim();
    const email = str(body.email).trim();
    const password = str(body.password);
    const items: ErrorItem[] = [];
    if (!name) items.push({ key: "name", message: M.enterName });
    if (!isEmail(email)) items.push({ key: "email", message: M.enterEmail });
    else if (await one("SELECT 1 FROM users WHERE email_lower = $1", [email.toLowerCase()]))
      items.push({ key: "email", message: M.emailTaken });
    if (Array.from(password).length < 8) items.push({ key: "password", message: M.passwordLength });
    if (items.length) throw validationFailed(items);
    let user: PublicUser;
    try {
      user = await createUser(name, email, password);
    } catch (error) {
      if ((error as pg.DatabaseError).code === "23505") throw validationFailed([{ key: "email", message: M.emailTaken }]);
      throw error;
    }
    startSession(ctx, await createSession(user.id));
    return json(201, { user });
  });

  router.add("POST", "/api/session", async (ctx) => {
    const body = ctx.json();
    const row = await one<PublicUser & { password_hash: string }>(
      "SELECT id, name, email, password_hash FROM users WHERE email_lower = $1",
      [str(body.email).trim().toLowerCase()],
    );
    if (!row || !(await passwordMatches(str(body.password), row.password_hash))) throw new ApiError("SIGN_IN_FAILED");
    startSession(ctx, await createSession(row.id));
    return json(200, { user: { id: row.id, name: row.name, email: row.email } });
  });

  router.add("GET", "/api/session", async (ctx) => json(200, { user: await requireUser(ctx) }));

  router.add("DELETE", "/api/session", async (ctx) => {
    const token = ctx.cookies[SESSION_COOKIE];
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
    ctx.setCookie(SESSION_COOKIE, "", 0);
    return json(204);
  });
}
