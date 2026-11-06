// Sessions: an HTTP-only, SameSite=Lax cookie holding a random token; Postgres keeps only its hash.
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";
import type { Account } from "../../shared/api.js";
import { unauthenticated } from "./errors.js";

const COOKIE = "pakka_session";

export interface AccountRow extends Account {
  kb_account_id: string | null;
}

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

function cookieToken(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return undefined;
}

export async function sessionAccount(db: Pool, req: IncomingMessage): Promise<AccountRow | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const { rows } = await db.query<AccountRow>(
    `SELECT a.id, a.name, a.email, a.phone, a.kb_account_id
       FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1`,
    [hash(token)],
  );
  return rows[0] ?? null;
}

/** Starts a session and returns its Set-Cookie header value. */
export async function startSession(db: Pool, accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)", [hash(token), accountId]);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export async function endSession(db: Pool, req: IncomingMessage): Promise<string> {
  const token = cookieToken(req);
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [hash(token)]);
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** The signed-in account of this request; routes marked `auth` are only reached with one. */
export function owner(ctx: { account: AccountRow | null }): AccountRow {
  if (!ctx.account) throw unauthenticated();
  return ctx.account;
}

export function publicAccount(row: AccountRow): Account {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone };
}
