// Accounts, salted slow password hashes and session tokens.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { query } from "./db.js";
import { ApiError, type Request, cookie } from "./http.js";
import { isObject } from "./json.js";

export interface Account {
  id: string;
  email: string;
  display_name: string;
}

const SESSION_COOKIE = "tf_session";

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await derive(password, salt)).toString("base64")}`;
}

// Compared against for unknown emails, so both refusals take the same work.
const DECOY = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

async function verify(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key ?? "", "base64");
  const actual = await derive(password, Buffer.from(salt ?? "", "base64"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const CREDENTIALS = new ApiError(401, "invalid_credentials", "Email or password is incorrect.");

export async function signIn(req: Request): Promise<{ account: Account; token: string }> {
  const body = isObject(req.body) ? req.body : {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const [row] = await query<Account & { password_hash: string }>(
    "SELECT id, email, display_name, password_hash FROM accounts WHERE email = $1",
    [email],
  );
  const matches = await verify(password, row?.password_hash ?? DECOY);
  if (!row || !matches) throw CREDENTIALS;
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)", [tokenHash(token), row.id]);
  return { account: { id: row.id, email: row.email, display_name: row.display_name }, token };
}

export async function currentAccount(req: Request): Promise<Account | null> {
  const token = cookie(req, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await query<Account>(
    "SELECT a.id, a.email, a.display_name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1",
    [tokenHash(token)],
  );
  return row ?? null;
}

export async function signOut(req: Request): Promise<void> {
  const token = cookie(req, SESSION_COOKIE);
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
