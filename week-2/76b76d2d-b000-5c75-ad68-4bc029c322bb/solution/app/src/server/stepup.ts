import { randomUUID } from "node:crypto";
import { STEPUP_PURPOSES } from "../shared/domain.ts";
import { config } from "./config.ts";
import { one, query, transaction } from "./db.ts";
import { stepupCode } from "./emails.ts";
import { ApiError } from "./errors.ts";
import { newStepupCode, sha256 } from "./ids.ts";
import { awaitSent, enqueue, nextMailNumber, wakeOutbox } from "./outbox.ts";
import { hasLiveVerification, type Session } from "./sessions.ts";
import { isoToronto } from "./time.ts";
import { Fields } from "./validate.ts";

const RESEND_SPACING_S = 30;
const SENDS_PER_WINDOW = 4;
const WRONG_CODE_CEILING = 5;
/** Leaves room inside the 5-second answer budget for the database round trips. */
const SEND_WAIT_MS = 3_000;

const ceilSeconds = (ms: number): number => Math.ceil(ms / 1000);
const minutes = (seconds: number): number => Math.ceil(seconds / 60);

type StepupAction = { creditApplied: number; tierChange: boolean };

/** The step-up requirement: an action that spends credit or changes tier needs a live verification. */
export function stepupRequired(session: Session | null, action: StepupAction, now: Date): boolean {
  const needed = action.tierChange || action.creditApplied > 0;
  return needed && (session === null || !hasLiveVerification(session, now));
}

export function requireStepup(session: Session | null, action: StepupAction, now: Date): void {
  if (stepupRequired(session, action, now)) throw new ApiError("stepup_required");
}

async function lockedFor(accountId: number, now: Date): Promise<number> {
  const lock = await one<{ locked_until: Date }>("SELECT locked_until FROM stepup_locks WHERE account_id = $1", [accountId]);
  return lock && lock.locked_until > now ? ceilSeconds(lock.locked_until.getTime() - now.getTime()) : 0;
}

function locked(seconds: number): ApiError {
  return new ApiError("stepup_locked", { minutes: minutes(seconds) }, { retryAfter: seconds });
}

/** Limits in published order: lockout, then spacing, then the rolling send limit. */
async function checkSendLimits(accountId: number, now: Date): Promise<void> {
  const lockedSeconds = await lockedFor(accountId, now);
  if (lockedSeconds) throw locked(lockedSeconds);
  const windowStart = new Date(now.getTime() - config.stepupLockoutSeconds * 1000);
  const sends = await query<{ sent_at: Date }>("SELECT sent_at FROM stepup_sends WHERE account_id = $1 AND sent_at > $2 ORDER BY sent_at", [accountId, windowStart]);
  const last = sends.at(-1);
  if (last && now.getTime() - last.sent_at.getTime() < RESEND_SPACING_S * 1000) {
    const wait = ceilSeconds(last.sent_at.getTime() + RESEND_SPACING_S * 1000 - now.getTime());
    throw new ApiError("resend_too_soon", { seconds: wait }, { retryAfter: wait });
  }
  const oldest = sends[0];
  if (sends.length >= SENDS_PER_WINDOW && oldest) {
    const wait = ceilSeconds(oldest.sent_at.getTime() + config.stepupLockoutSeconds * 1000 - now.getTime());
    throw new ApiError("code_send_limit", { minutes: minutes(wait) }, { retryAfter: wait });
  }
}

/** Issues a fresh code for a challenge, records the send and emails it through the outbox. */
async function sendCode(session: Session, challengeId: string, isNew: boolean, now: Date): Promise<Record<string, unknown>> {
  const account = session.account;
  const code = newStepupCode();
  const expiresAt = new Date(now.getTime() + config.stepupCodeTtlSeconds * 1000);
  const key = await transaction(async (tx) => {
    await tx.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [account.id]);
    await checkSendLimits(account.id, now);
    if (isNew) await tx.query("INSERT INTO stepup_challenges (id, account_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)", [challengeId, account.id, sha256(code), expiresAt]);
    else await tx.query("UPDATE stepup_challenges SET code_hash = $2, expires_at = $3 WHERE id = $1", [challengeId, sha256(code), expiresAt]);
    await tx.query("INSERT INTO stepup_sends (account_id, sent_at) VALUES ($1, $2)", [account.id, now]);
    const locale = (await one<{ locale: "en" | "fr" }>("SELECT locale FROM accounts WHERE id = $1", [account.id], tx))?.locale ?? account.locale;
    const n = await nextMailNumber(tx, `stepup-code:${account.number}`);
    const mailKey = `stepup-code:${account.number}:${n}`;
    await enqueue(tx, { key: mailKey, kind: "stepup-code", to: account.email, ...stepupCode(locale, code, minutes(config.stepupCodeTtlSeconds)) });
    return mailKey;
  });
  wakeOutbox();
  const sent = await awaitSent(key, SEND_WAIT_MS);
  const [local = "", domain = ""] = account.email.split("@");
  return { challenge: { id: challengeId, expires_at: isoToronto(expiresAt), delivery: sent ? "sent" : "queued", masked_email: `${local.slice(0, 1)}***@${domain}` } };
}

export async function startStepup(session: Session, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const now = new Date();
  const fields = new Fields(body);
  await checkSendLimits(session.account.id, now);
  fields.choice("purpose", STEPUP_PURPOSES);
  fields.done();
  return sendCode(session, randomUUID(), true, now);
}

async function ownChallenge(session: Session, id: unknown): Promise<{ id: string; code_hash: string; expires_at: Date; wrong_attempts: number; used: boolean }> {
  const valid = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
  const challenge = valid
    ? await one<{ id: string; code_hash: string; expires_at: Date; wrong_attempts: number; used: boolean }>(
        "SELECT id, code_hash, expires_at, wrong_attempts, used FROM stepup_challenges WHERE id = $1 AND account_id = $2", [id, session.account.id])
    : undefined;
  if (!challenge || challenge.used) throw new ApiError("not_found");
  return challenge;
}

export async function resendStepup(session: Session, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const challenge = await ownChallenge(session, body.challenge_id);
  return sendCode(session, challenge.id, false, new Date());
}

export async function verifyStepup(session: Session, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const challenge = await ownChallenge(session, body.challenge_id);
  const now = new Date();
  const lockedSeconds = await lockedFor(session.account.id, now);
  if (lockedSeconds) throw locked(lockedSeconds);
  if (now >= challenge.expires_at) throw new ApiError("code_expired");
  const fields = new Fields(body);
  const code = fields.text("code", 6, 6);
  fields.done();
  if (sha256(code) !== challenge.code_hash) {
    const wrong = await one<{ wrong_attempts: number }>(
      "UPDATE stepup_challenges SET wrong_attempts = wrong_attempts + 1 WHERE id = $1 RETURNING wrong_attempts", [challenge.id]);
    const count = wrong?.wrong_attempts ?? WRONG_CODE_CEILING;
    if (count >= WRONG_CODE_CEILING) {
      await query(
        "INSERT INTO stepup_locks (account_id, locked_until) VALUES ($1, $2) ON CONFLICT (account_id) DO UPDATE SET locked_until = $2",
        [session.account.id, new Date(now.getTime() + config.stepupLockoutSeconds * 1000)],
      );
      await query("UPDATE stepup_challenges SET wrong_attempts = 0 WHERE id = $1", [challenge.id]);
      throw locked(config.stepupLockoutSeconds);
    }
    const left = WRONG_CODE_CEILING - count;
    throw new ApiError("code_incorrect", { n: left }, { attempts_left: left });
  }
  const validUntil = new Date(now.getTime() + config.stepupValidSeconds * 1000);
  await query("UPDATE stepup_challenges SET used = true WHERE id = $1", [challenge.id]);
  await query("UPDATE sessions SET stepup_valid_until = $2 WHERE token_hash = $1", [session.tokenHash, validUntil]);
  return { stepup: { verified: true, valid_until: isoToronto(validUntil) } };
}
