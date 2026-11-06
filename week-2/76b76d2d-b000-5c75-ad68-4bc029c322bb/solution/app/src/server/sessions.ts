import type { Locale, Role } from "../shared/domain.ts";
import { one, query } from "./db.ts";
import { newToken, sha256 } from "./ids.ts";

export type AccountRow = { id: number; number: string | null; email: string; name: string; role: Role; locale: Locale; kb_account_id: string | null };
export type Session = { tokenHash: string; account: AccountRow; stepupValidUntil: Date | null };

export const SESSION_COOKIE = "halide_session";
export const GUEST_COOKIE = "halide_guest";
export const LOCALE_COOKIE = "halide_locale";
export const COOKIE_YEAR_S = 365 * 86_400;

export async function resolveSession(cookies: Record<string, string>): Promise<Session | null> {
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await one<AccountRow & { token_hash: string; stepup_valid_until: Date | null }>(
    `SELECT s.token_hash, s.stepup_valid_until, a.id, a.number, a.email, a.name, a.role, a.locale, a.kb_account_id
       FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1`,
    [sha256(token)],
  );
  if (!row) return null;
  const { token_hash, stepup_valid_until, ...account } = row;
  return { tokenHash: token_hash, account, stepupValidUntil: stepup_valid_until };
}

/** Starts a session and returns the cookie token. */
export async function startSession(accountId: number): Promise<string> {
  const token = newToken();
  await query("INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)", [sha256(token), accountId]);
  return token;
}

export async function endSession(session: Session): Promise<void> {
  await query("DELETE FROM sessions WHERE token_hash = $1", [session.tokenHash]);
}

/** A session has a live verification while server time is strictly before its `valid_until`. */
export function hasLiveVerification(session: Session, now: Date): boolean {
  return session.stepupValidUntil !== null && now.getTime() < session.stepupValidUntil.getTime();
}
