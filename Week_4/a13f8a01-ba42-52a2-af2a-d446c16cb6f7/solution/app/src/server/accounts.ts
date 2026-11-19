import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { User } from "../shared/types.js";
import { config } from "./config.js";
import { pool, transaction, type Tx } from "./db.js";
import { ApiError, validation } from "./errors.js";
import { newId, newToken } from "./ids.js";
import { sendMail, verificationMessage } from "./mail.js";

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

const HANDLE_SHAPE = /^[a-z0-9-]{3,20}$/;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PASSWORD_MIN = 10;
const SESSION_DAYS = 30;

export const SESSION_COOKIE = "ashlar_session";
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

interface UserRow {
  id: string;
  handle: string;
  email: string;
  verified: boolean;
  verification_sent: boolean;
}

const USER_COLUMNS = "id, handle, email, verified, verification_sent";

function toUser(row: UserRow): User {
  return { id: row.id, handle: row.handle, email: row.email, verified: row.verified };
}

function sha(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt, 32)).toString("hex")}`;
}

async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  const [salt, expected] = (stored ?? "").split(":");
  const reference = Buffer.from(expected ?? "", "hex");
  const actual = await derive(password, Buffer.from(salt ?? "", "hex"), 32);
  return stored !== null && reference.length === actual.length && timingSafeEqual(reference, actual);
}

interface NewAccount {
  handle: string;
  email: string;
  password: string | null;
  verified: boolean;
}

export async function createUser(tx: Tx, account: NewAccount): Promise<User> {
  const id = newId();
  const hash = account.password === null ? null : await hashPassword(account.password);
  const created = await tx.query<UserRow>(
    `INSERT INTO users (id, handle, email, password_hash, verified, verification_sent) VALUES ($1, $2, $3, $4, $5, $5)
     RETURNING ${USER_COLUMNS}`,
    [id, account.handle, account.email, hash, account.verified],
  );
  return toUser(created.rows[0] as UserRow);
}

export async function takenFields(handle: string, email: string): Promise<Record<string, string>> {
  const taken = await pool.query<{ handle: string; email: string }>(
    "SELECT handle, email FROM users WHERE handle = $1 OR lower(email) = lower($2)",
    [handle, email],
  );
  const fields: Record<string, string> = {};
  for (const row of taken.rows) {
    if (row.handle === handle) fields["handle"] = "That handle is taken.";
    if (row.email.toLowerCase() === email.toLowerCase()) fields["email"] = "That email already has an account.";
  }
  return fields;
}

export function signUpProblems(handle: string, email: string, password: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!HANDLE_SHAPE.test(handle)) fields["handle"] = "Use 3 to 20 lowercase letters, digits or hyphens.";
  if (!EMAIL_SHAPE.test(email)) fields["email"] = "Enter an email address like name@example.com.";
  if ([...password].length < PASSWORD_MIN) fields["password"] = "Use at least 10 characters.";
  return fields;
}

async function openSession(tx: Tx, userId: string): Promise<string> {
  const token = newToken();
  await tx.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [sha(token), userId]);
  return token;
}

async function issueVerification(tx: Tx, user: User): Promise<boolean> {
  const token = newToken();
  await tx.query("UPDATE verify_tokens SET used = true WHERE user_id = $1 AND NOT used", [user.id]);
  await tx.query("INSERT INTO verify_tokens (token_hash, user_id, issued_at) VALUES ($1, $2, clock_timestamp())", [sha(token), user.id]);
  try {
    await sendMail(verificationMessage(user.handle, user.email, token));
  } catch {
    return false;
  }
  return true;
}

interface SignedUp {
  user: User;
  verification: "sent" | "pending";
  session: string;
}

// Postgres text cannot hold a NUL; a field that carries one reads as empty, so it is refused or never matches.
const noNul = (value: string): string => (value.includes("\u0000") ? "" : value);

export async function signUp(input: { handle: unknown; email: unknown; password: unknown }): Promise<SignedUp> {
  const handle = typeof input.handle === "string" ? noNul(input.handle) : "";
  const email = typeof input.email === "string" ? noNul(input.email.trim()) : "";
  const password = typeof input.password === "string" ? input.password : "";
  const taken = await takenFields(handle, email);
  if (Object.keys(taken).length > 0) throw new ApiError("duplicate", Object.values(taken)[0] as string, { fields: taken });
  const problems = signUpProblems(handle, email, password);
  if (Object.keys(problems).length > 0) throw validation(problems);
  try {
    return await transaction(async (tx) => {
      const user = await createUser(tx, { handle, email, password, verified: false });
      const session = await openSession(tx, user.id);
      const sent = await issueVerification(tx, user);
      await tx.query("UPDATE users SET verification_sent = $2 WHERE id = $1", [user.id, sent]);
      return { user, verification: sent ? "sent" : "pending", session } as const;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError("duplicate", "That handle is taken.", { fields: await takenFields(handle, email) });
    }
    throw error;
  }
}

export async function signIn(email: unknown, password: unknown): Promise<{ user: User; session: string }> {
  const found = await pool.query<UserRow & { password_hash: string | null }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(email) = lower($1)`,
    [typeof email === "string" ? noNul(email.trim()) : ""],
  );
  const row = found.rows[0];
  const matches = await passwordMatches(typeof password === "string" ? password : "", row?.password_hash ?? null);
  if (!row || !matches) throw new ApiError("bad_credentials", "That email or password is not right.");
  const session = await transaction((tx) => openSession(tx, row.id));
  return { user: toUser(row), session };
}

export async function signOut(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha(token)]);
}

export async function userForSession(token: string): Promise<{ user: User; verification: "sent" | "pending" | null } | null> {
  const found = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS.split(", ").map((column) => `u.${column}`).join(", ")} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [sha(token)],
  );
  const row = found.rows[0];
  if (!row) return null;
  return { user: toUser(row), verification: row.verified ? null : row.verification_sent ? "sent" : "pending" };
}

export async function sessionFor(handle: string): Promise<{ user: User; session: string } | null> {
  const found = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE handle = $1`, [noNul(handle)]);
  const row = found.rows[0];
  if (!row) return null;
  return { user: toUser(row), session: await transaction((tx) => openSession(tx, row.id)) };
}

export async function verify(token: unknown): Promise<User> {
  const lookup = await pool.query<{ user_id: string; used: boolean; expired: boolean }>(
    `SELECT user_id, used, extract(epoch FROM clock_timestamp() - issued_at) >= $2 AS expired FROM verify_tokens WHERE token_hash = $1`,
    [sha(typeof token === "string" ? token : ""), config.verifyTtlSeconds],
  );
  const row = lookup.rows[0];
  if (!row || row.used) throw new ApiError("token_invalid", "This link is not valid. It may have been used already.");
  if (row.expired) throw new ApiError("token_expired", "This link has expired. Sign in and use Resend link to get a new one.");
  return transaction(async (tx) => {
    const claimed = await tx.query("UPDATE verify_tokens SET used = true WHERE token_hash = $1 AND NOT used", [sha(token as string)]);
    if (claimed.rowCount === 0) throw new ApiError("token_invalid", "This link is not valid. It may have been used already.");
    const updated = await tx.query<UserRow>(`UPDATE users SET verified = true WHERE id = $1 RETURNING ${USER_COLUMNS}`, [row.user_id]);
    return toUser(updated.rows[0] as UserRow);
  });
}

export async function resendVerification(user: User): Promise<void> {
  if (user.verified) throw new ApiError("already_verified", "This account is already verified.");
  await transaction(async (tx) => {
    if (!(await issueVerification(tx, user))) {
      throw new ApiError("mail_unavailable", "Mail is unreachable, so the link was not sent. Try Resend link again in a moment.");
    }
    await tx.query("UPDATE users SET verification_sent = true WHERE id = $1", [user.id]);
  });
}
