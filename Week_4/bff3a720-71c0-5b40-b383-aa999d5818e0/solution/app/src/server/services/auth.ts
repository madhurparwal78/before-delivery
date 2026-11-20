import { randomBytes, randomInt } from "node:crypto";
import { now, nowMs, plusSeconds } from "../clock";
import { config } from "../config";
import { newId, type Db, type TxHandle } from "../db";
import { apiErrors } from "../http/errors";
import { codeRateKey, restoreRate, takeFromWindow } from "../valkey";
import { emails } from "./emails";
import { enqueue } from "./outbox";
import type { MemberRow } from "./views";

const HOUR_MS = 3_600_000;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function memberBySession(db: Db, token: string): Promise<MemberRow | undefined> {
  const { rows } = await db.query<MemberRow>("SELECT m.* FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = $1", [token]);
  return rows[0];
}

export async function createSession(db: Db, memberId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token, member_id, created_at) VALUES ($1, $2, $3)", [token, memberId, now()]);
  return token;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token = $1", [token]);
}

/** Take a slot in the per-email sign-in code window; a refused request writes nothing. */
export async function takeCodeSlot(email: string, codeId: string): Promise<void> {
  const verdict = await takeFromWindow(codeRateKey(email), nowMs(), HOUR_MS, config.signinCodeRatePerHour, codeId);
  if (!verdict.allowed) throw apiErrors.codeRateLimited(verdict.retryAfterSeconds);
}

/** Issue a six-digit code; older codes for the email stop working. */
export async function issueCode(db: TxHandle, email: string, codeId: string): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.query("UPDATE sign_in_codes SET used = true WHERE email = $1 AND used = false", [email]);
  await db.query("INSERT INTO sign_in_codes (id, email, code, issued_at) VALUES ($1, $2, $3, $4)", [codeId, email, code, now()]);
  await enqueue(db, emails.signInCode(email, code));
}

/** Check the newest unused code; it is spent on success. */
export async function spendCode(db: Db, email: string, code: string): Promise<void> {
  const { rows } = await db.query<{ id: string; code: string; issued_at: Date }>(
    "SELECT id, code, issued_at FROM sign_in_codes WHERE email = $1 AND used = false ORDER BY issued_at DESC, id LIMIT 1",
    [email],
  );
  const issued = rows[0];
  if (!issued || issued.code !== code) throw apiErrors.codeInvalid();
  if (now().getTime() >= plusSeconds(issued.issued_at, config.emailCodeTtlSeconds).getTime()) throw apiErrors.codeExpired();
  await db.query("UPDATE sign_in_codes SET used = true WHERE id = $1", [issued.id]);
}

export async function memberByEmail(db: Db, email: string): Promise<MemberRow | undefined> {
  const { rows } = await db.query<MemberRow>("SELECT * FROM members WHERE email = $1", [email]);
  return rows[0];
}

export async function createMember(db: Db, email: string, displayName: string): Promise<MemberRow> {
  const id = newId();
  await db.query(
    `INSERT INTO members (id, email, display_name, roles, id_state, created_at) VALUES ($1, $2, $3, ARRAY['driver', 'passenger'], 'none', $4)`,
    [id, email, displayName, now()],
  );
  return (await memberByEmail(db, email)) as MemberRow;
}

/** Rebuild the sign-in code counter from codes issued in the last 60 minutes. */
export async function restoreCodeRates(db: Db): Promise<void> {
  const { rows } = await db.query<{ id: string; email: string; issued_at: Date }>("SELECT id, email, issued_at FROM sign_in_codes WHERE issued_at > $1", [new Date(nowMs() - HOUR_MS)]);
  const byEmail = new Map<string, { member: string; scoreMs: number }[]>();
  for (const row of rows) byEmail.set(row.email, [...(byEmail.get(row.email) ?? []), { member: row.id, scoreMs: row.issued_at.getTime() }]);
  for (const [email, entries] of byEmail) await restoreRate(codeRateKey(email), entries);
}
