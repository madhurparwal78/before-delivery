import { config } from "./config.js";
import { one, query, transaction, type Executor } from "./db.js";
import { secretToken } from "./id.js";

export type Role = "shopper" | "seller" | "support";

export interface Actor {
  accountId: string;
  role: Role;
  sellerId: string | null;
  name: string;
  sessionId: string;
}

export const COOKIE = { pending: "chauraha_pending", session: "chauraha_session", access: "chauraha_access" } as const;

export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(name: string): string {
  return cookieHeader(name, "", 0);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const found: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) found[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return found;
}

interface ActorRow {
  account_id: string;
  role: Role;
  seller_id: string | null;
  name: string;
  session_id: string;
}

export async function resolveActor(accessToken: string | undefined, nowMs: number): Promise<Actor | null> {
  if (!accessToken) return null;
  const row = await one<ActorRow>(
    `SELECT a.id AS account_id, a.role, a.seller_id, a.name, s.id AS session_id
       FROM access_tokens t JOIN sessions s ON s.id = t.session_id JOIN accounts a ON a.id = s.account_id
      WHERE t.id = $1 AND t.expires_at > $2 AND s.expires_at > $2`,
    [accessToken, nowMs],
  );
  return row ? { accountId: row.account_id, role: row.role, sellerId: row.seller_id, name: row.name, sessionId: row.session_id } : null;
}

/** A full session: a refresh cookie that lasts SESSION_TTL_SECONDS and an access cookie that lasts ACCESS_TTL_SECONDS. */
export async function issueSession(accountId: string, nowMs: number, executor?: Executor): Promise<string[]> {
  const sessionId = secretToken();
  const accessId = secretToken();
  const run = async (client: Executor): Promise<void> => {
    await query("INSERT INTO sessions (id, account_id, expires_at) VALUES ($1, $2, $3)", [sessionId, accountId, nowMs + config.seconds.sessionTtl * 1000], client);
    await query("INSERT INTO access_tokens (id, session_id, expires_at) VALUES ($1, $2, $3)", [accessId, sessionId, nowMs + config.seconds.accessTtl * 1000], client);
  };
  if (executor) await run(executor);
  else await transaction(run);
  return [cookieHeader(COOKIE.session, sessionId, config.seconds.sessionTtl), cookieHeader(COOKIE.access, accessId, config.seconds.accessTtl)];
}

/** Refresh works while the session exists: a new access token for the same session. */
export async function refreshAccess(sessionId: string | undefined, nowMs: number): Promise<string[] | null> {
  if (!sessionId) return null;
  const session = await one<{ id: string }>("SELECT id FROM sessions WHERE id = $1 AND expires_at > $2", [sessionId, nowMs]);
  if (!session) return null;
  const accessId = secretToken();
  await query("INSERT INTO access_tokens (id, session_id, expires_at) VALUES ($1, $2, $3)", [accessId, session.id, nowMs + config.seconds.accessTtl * 1000]);
  return [cookieHeader(COOKIE.access, accessId, config.seconds.accessTtl)];
}

export async function endSession(sessionId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

export async function endAllSessions(accountId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE account_id = $1", [accountId]);
}

/** Password change: every other session ends, the current one continues under a new session id. */
export async function rotateSession(accountId: string, nowMs: number): Promise<string[]> {
  return transaction(async (client) => {
    await query("DELETE FROM sessions WHERE account_id = $1", [accountId], client);
    return issueSession(accountId, nowMs, client);
  });
}
