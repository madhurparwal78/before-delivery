import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Account } from "../shared/types";
import { first, pool, type Queryable } from "./db";
import { sha256Hex } from "./digest";
import { ApiError } from "./errors";
import { endSessionStreams } from "./stream-hub";
import type { Request } from "./http-types";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keyLength: number) => Promise<Buffer>;

export const SESSION_COOKIE = "qy_session";
const SESSION_TTL_SECONDS = 30 * 24 * 3600;
const KEY_LENGTH = 64;

export const ACCOUNT_COLUMNS = `a.id, a.kind, a.display_name AS "displayName", a.email, a.email_verified AS "emailVerified",
  a.classroom_id AS "classroomId", a.nickname`;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await scryptAsync(password, salt, KEY_LENGTH)).toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Stands in for a stored hash when no account matches, so an unknown email costs the same time as a wrong password. */
const unknownAccountHash = hashPassword(randomBytes(16).toString("hex"));

export async function spendPasswordCheck(password: string): Promise<void> {
  await passwordMatches(password, await unknownAccountHash);
}

type Identity =
  | { kind: "anonymous" }
  | { kind: "pending"; classroomId: string; sessionHash: string }
  | { kind: "ended"; message: string }
  | { kind: "account"; account: Account; sessionHash: string };

interface SessionRow {
  accountId: string | null;
  pendingClassroomId: string | null;
  removedMessage: string | null;
}

/** Who a `qy_session` cookie value stands for. */
export async function identify(token: string | undefined): Promise<Identity> {
  if (!token) return { kind: "anonymous" };
  const sessionHash = sha256Hex(token);
  const session = await first<SessionRow>(pool,
    `SELECT account_id AS "accountId", pending_classroom_id AS "pendingClassroomId", removed_message AS "removedMessage"
     FROM sessions WHERE token_hash = $1 AND expires_at > now()`, [sessionHash]);
  if (!session) return { kind: "anonymous" };
  if (session.removedMessage) return { kind: "ended", message: session.removedMessage };
  if (session.pendingClassroomId) return { kind: "pending", classroomId: session.pendingClassroomId, sessionHash };
  const account = await first<Account>(pool,
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts a LEFT JOIN classrooms c ON c.id = a.classroom_id
     WHERE a.id = $1 AND c.archived_at IS NULL`, [session.accountId]);
  return account ? { kind: "account", account, sessionHash } : { kind: "anonymous" };
}

/** The 401 for a session that ended because the account was removed from its classroom. */
export function removedError(identity: Extract<Identity, { kind: "ended" }>): ApiError {
  return new ApiError("removed", { message: identity.message });
}

interface Principal {
  account: Account;
  sessionHash: string;
}

/**
 * The signed-in account, or the 401 the request earns: removed, or signed out (which includes pending and archived).
 * A signed-in cross-origin write is then refused 403.
 */
export async function requirePrincipal(req: Request): Promise<Principal> {
  const identity = await identify(req.cookie(SESSION_COOKIE));
  if (identity.kind === "ended") throw removedError(identity);
  if (identity.kind !== "account") throw new ApiError("signed_out");
  if (req.crossOrigin) throw new ApiError("forbidden");
  return { account: identity.account, sessionHash: identity.sessionHash };
}

/** Starts a session and returns its `Set-Cookie` value. Whatever session the request carried ends. */
export async function startSession(
  req: Request, owner: { accountId: string } | { pendingClassroomId: string }, db: Queryable = pool,
): Promise<string> {
  const previous = req.cookie(SESSION_COOKIE);
  if (previous) {
    const previousHash = sha256Hex(previous);
    await db.query("DELETE FROM sessions WHERE token_hash = $1", [previousHash]);
    endSessionStreams(previousHash);
  }
  const token = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions (token_hash, account_id, pending_classroom_id, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))",
    [sha256Hex(token), "accountId" in owner ? owner.accountId : null, "pendingClassroomId" in owner ? owner.pendingClassroomId : null, SESSION_TTL_SECONDS],
  );
  return cookieHeader(token, SESSION_TTL_SECONDS);
}

export function cookieHeader(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export async function endSession(sessionHash: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sessionHash]);
  endSessionStreams(sessionHash);
}
