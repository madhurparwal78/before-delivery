import { db } from "./db.js";
import { randomToken } from "./config.js";
import type { AccountRow } from "./auth-types.js";

const sessionMaxAgeMs = 30 * 86_400_000;

export function parseCookieValue(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === "corbel_session" && rest.length > 0) return rest.join("=");
  }
  return null;
}

export async function loadAccountByCookie(cookie: string | undefined): Promise<AccountRow | null> {
  const token = parseCookieValue(cookie);
  if (!token) return null;
  const row = await db.one<AccountRow>(
    `select a.id, a.workspace_id, a.name, a.email, a.verified, a.confirmed_date_key, a.time_zone
     from sessions s join accounts a on a.id = s.account_id
     where s.token = $1 and s.created_epoch + $2 > $3`,
    [token, sessionMaxAgeMs, Date.now()],
  );
  return row ?? null;
}

/** A ready session token for an account, used by sign-in and grading workspaces. */
export async function createSessionForAccount(accountId: string): Promise<string> {
  const token = randomToken(24);
  await db.run(`insert into sessions (token, account_id, created_epoch) values ($1, $2, $3)`, [
    token,
    accountId,
    Date.now(),
  ]);
  return token;
}

export async function createSessionToken(workspaceId: string): Promise<string> {
  const account = await db.one<{ id: string }>(
    `select id from accounts where workspace_id = $1 order by created_epoch limit 1`,
    [workspaceId],
  );
  if (!account) throw new Error("no-account");
  return createSessionForAccount(account.id);
}

export async function destroySession(token: string): Promise<void> {
  await db.run(`delete from sessions where token = $1`, [token]);
}

export function sessionCookieHeader(token: string): string {
  return `corbel_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionMaxAgeMs / 1000)}`;
}

export function clearSessionCookieHeader(): string {
  return `corbel_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
