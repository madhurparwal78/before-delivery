// Accounts and sessions (brief: Accounts, Sessions). Passwords are scrypt hashes; the session is
// an opaque token in the HttpOnly, SameSite=Lax `lw_session` cookie.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ApiError, requireFields } from "../shared/errors";
import { emailError, nameError, normaliseEmail, passwordError } from "../shared/text";
import type { UserView } from "../shared/types";
import { isUniqueViolation, pool, transaction, type Queryable } from "./db";
import { json, objectBody, route, type Reply, type Request } from "./http";
import { newId, token } from "./ids";
import { acceptOpenInvites } from "./members";
import { closeSession } from "./live";
import { copy } from "../shared/copy";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
export const SESSION_COOKIE = "lw_session";

export interface SessionUser extends UserView {
  sessionId: string;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = await scrypt(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

/** The signed-in person for a session token, or null. */
export async function userForToken(sessionId: string | undefined): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const { rows } = await pool.query<{ id: string; email: string; name: string }>(
    "SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1", [sessionId]);
  const row = rows[0];
  return row ? { ...row, sessionId } : null;
}

export async function currentUser(req: Request): Promise<SessionUser | null> {
  return userForToken(req.cookies.get(SESSION_COOKIE));
}

/** Step 1 of the error precedence: 401 unauthenticated. */
export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await currentUser(req);
  if (!user) throw new ApiError("unauthenticated");
  return user;
}

function cookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

async function startSession(db: Queryable, user: UserView, status: number): Promise<Reply> {
  const sessionId = token();
  await db.query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [sessionId, user.id]);
  return json(status, { user }, { "Set-Cookie": cookie(sessionId, 60 * 60 * 24 * 30) });
}

export async function createUser(db: Queryable, email: string, name: string, password: string): Promise<UserView> {
  const user = { id: newId("u_"), email: normaliseEmail(email), name };
  await db.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)",
    [user.id, user.email, user.name, await hashPassword(password)]);
  return user;
}

export async function emailTaken(db: Queryable, email: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM users WHERE email = $1", [normaliseEmail(email)]);
  return !!rowCount;
}

route("POST", "/api/auth/signup", async (req) => {
  const body = objectBody(req.body);
  const { name, email, password } = body;
  if (emailError(email) === null && (await emailTaken(pool, email as string))) {
    throw new ApiError("email_taken", copy.fields.emailTaken, { email: copy.fields.emailTaken });
  }
  requireFields({ name: nameError(name), email: emailError(email), password: passwordError(password) });
  try {
    return await transaction(async (db) => {
      const user = await createUser(db, email as string, name as string, password as string);
      await acceptOpenInvites(db, user);
      return startSession(db, user, 201);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError("email_taken", copy.fields.emailTaken, { email: copy.fields.emailTaken });
    throw error;
  }
});

route("POST", "/api/auth/signin", async (req) => {
  const { email, password } = objectBody(req.body);
  if (typeof email !== "string" || typeof password !== "string") throw new ApiError("bad_credentials", copy.signInError);
  const { rows } = await pool.query<{ id: string; email: string; name: string; password_hash: string }>(
    "SELECT id, email, name, password_hash FROM users WHERE email = $1", [normaliseEmail(email)]);
  const row = rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new ApiError("bad_credentials", copy.signInError);
  const user = { id: row.id, email: row.email, name: row.name };
  return transaction(async (db) => {
    await acceptOpenInvites(db, user);
    return startSession(db, user, 200);
  });
});

route("POST", "/api/auth/signout", async (req) => {
  const sessionId = req.cookies.get(SESSION_COOKIE);
  if (sessionId) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    closeSession(sessionId);
  }
  return { status: 204, headers: { "Set-Cookie": cookie("", 0) } };
});

route("GET", "/api/me", async (req) => {
  const { sessionId: _sessionId, ...user } = await requireUser(req);
  return json(200, { user });
});
