import * as crypto from "node:crypto";
import { db } from "./db.js";
import { config, isStudioZone, randomToken } from "./config.js";
import { ValidationError, bad, validation } from "./errors.js";
import { sendMail } from "./providers/mail.js";
import { studioDateKey, workspaceNow, trialDaysLeft, trialEnded } from "./clock.js";
import type { AccountRow } from "./auth-types.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

export function validateName(name: unknown): string {
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 80) {
    throw validation({ name: "Enter your name (1 to 80 characters)." });
  }
  return name.trim();
}

export function validateEmailValue(email: unknown): string {
  if (typeof email !== "string" || !emailPattern.test(email.trim())) {
    throw validation({ email: "Enter a valid email address." });
  }
  return email.trim().toLowerCase();
}

export function validatePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 10) {
    throw validation({ password: "Use at least 10 characters." });
  }
  return password;
}

export function validateTimeZone(zone: unknown): string {
  if (typeof zone !== "string" || !isStudioZone(zone)) {
    throw validation({ time_zone: "Choose a studio time zone from the list." });
  }
  return zone;
}

/** Trial state decided in this one place. */
export async function trialState(account: AccountRow): Promise<{ days_left: number; ended: boolean }> {
  const { epochMs } = await workspaceNow(account.workspace_id);
  const zone = account.time_zone;
  const confirmation = account.confirmed_date_key ?? studioDateKey(epochMs, zone);
  const left = trialDaysLeft(confirmation, epochMs, zone);
  return { days_left: left, ended: trialEnded(confirmation, epochMs, zone) };
}

export async function signUp(input: unknown): Promise<{
  user: { id: string; name: string; email: string; verified: boolean };
  email_status: "sent" | "not_sent";
}> {
  const body = (input ?? {}) as Record<string, unknown>;
  const name = validateName(body.name);
  const email = validateEmailValue(body.email);
  const password = validatePassword(body.password);
  const zone = validateTimeZone(body.time_zone ?? "UTC");
  const existing = await db.one<{ id: string }>(`select id from accounts where email_lower = $1`, [email]);
  if (existing) throw validation({ email: "An account with this email already exists." });
  const workspaceId = randomToken(9);
  const accountId = randomToken(9);
  const folderId = randomToken(9);
  const now = Date.now();
  await db.tx(async (client) => {
    await client.query(`insert into workspaces (id, kind, time_zone, created_epoch) values ($1, 'account', $2, $3)`, [
      workspaceId,
      zone,
      now,
    ]);
    await client.query(
      `insert into accounts (id, workspace_id, name, email, email_lower, password_hash, verified, time_zone, created_epoch)
       values ($1, $2, $3, $4, $5, $6, false, $7, $8)`,
      [accountId, workspaceId, name, email, email, hashPassword(password), zone, now],
    );
    await client.query(
      `insert into folders (id, workspace_id, parent_id, name, name_lower, modified_epoch, created_epoch)
       values ($1, $2, null, 'My Drawings', 'my drawings', $3, $3)`,
      [folderId, workspaceId, now],
    );
    await client.query(
      `insert into title_block_revisions (workspace_id, letter, footer_note, effective_date, position)
       values ($1, 'A', 'Issued for coordination.', $2, 0)`,
      [workspaceId, studioDateKey(now, zone)],
    );
  });
  await seedBlocksFor(workspaceId);
  const sent = await sendConfirmation(email);
  return { user: { id: accountId, name, email, verified: false }, email_status: sent ? "sent" : "not_sent" };
}

async function seedBlocksFor(workspaceId: string): Promise<void> {
  const { blockLibrary } = await import("../shared/types.js");
  for (const block of blockLibrary) {
    await db.run(`insert into blocks (workspace_id, name, definition) values ($1, $2, $3)`, [
      workspaceId,
      block.name,
      JSON.stringify(block),
    ]);
  }
}

export async function sendConfirmation(email: string): Promise<boolean> {
  const account = await db.one<{ id: string; verified: boolean; workspace_id: string }>(
    `select id, verified, workspace_id from accounts where email_lower = $1`,
    [email],
  );
  if (!account) return true;
  const token = randomToken(24);
  await db.run(`insert into confirm_tokens (id, account_id, created_epoch) values ($1, $2, $3)`, [
    token,
    account.id,
    Date.now(),
  ]);
  const sent = await sendMail({
    to: email,
    subject: "Confirm your Corbel Draft account",
    text: `${config.publicUrl}/verify/${token}`,
  });
  if (sent) {
    await db.run(`delete from confirm_tokens where account_id = $1 and id <> $2`, [account.id, token]);
  }
  return sent;
}

export interface VerifyOutcome {
  kind: "confirmed" | "already" | "expired" | "replaced" | "unknown";
  email: string;
}

export async function verify(tokenInput: string): Promise<VerifyOutcome> {
  const row = await db.one<{ id: string; account_id: string; created_epoch: string }>(
    `select id, account_id, created_epoch from confirm_tokens where id = $1`,
    [tokenInput],
  );
  if (!row) return { kind: "unknown", email: "" };
  const account = await db.one<AccountRow>(`select * from accounts where id = $1`, [row.account_id]);
  if (!account) return { kind: "unknown", email: "" };
  if (account.verified) return { kind: "already", email: account.email };
  const { epochMs } = await workspaceNow(account.workspace_id);
  if (Number(row.created_epoch) + config.limits.VERIFY_LINK_SECONDS * 1000 <= epochMs) {
    return { kind: "expired", email: account.email };
  }
  const newest = await db.one<{ id: string }>(
    `select id from confirm_tokens where account_id = $1 order by created_epoch desc, id desc limit 1`,
    [account.id],
  );
  if (newest && newest.id !== row.id) {
    return { kind: "replaced", email: account.email };
  }
  await db.run(`update accounts set verified = true, confirmed_date_key = $1 where id = $2`, [
    studioDateKey(epochMs, account.time_zone),
    account.id,
  ]);
  await db.run(`delete from confirm_tokens where account_id = $1`, [account.id]);
  return { kind: "confirmed", email: account.email };
}

export async function resendConfirmation(target: string): Promise<"sent" | "not_sent"> {
  const email = target.trim().toLowerCase();
  const account = await db.one<{ id: string }>(`select id from accounts where email_lower = $1`, [email]);
  if (!account) return "sent";
  const ok = await sendConfirmation(email);
  return ok ? "sent" : "not_sent";
}

export interface SignInOutcome {
  ok: boolean;
  account?: AccountRow;
  error?: "invalid_credentials" | "unverified" | "signin_locked";
  minutes?: number;
  email?: string;
}

export async function signIn(emailInput: string, password: string): Promise<SignInOutcome> {
  const email = emailInput.trim().toLowerCase();
  const row = await db.one<{
    id: string;
    workspace_id: string;
    name: string;
    email: string;
    verified: boolean;
    confirmed_date_key: string | null;
    time_zone: string;
    password_hash: string;
    signin_failures: number;
    locked_until: string | null;
  }>(`select * from accounts where email_lower = $1`, [email]);
  if (!row) return { ok: false, error: "invalid_credentials" };
  const { epochMs } = await workspaceNow(row.workspace_id);
  if (row.locked_until && Number(row.locked_until) > epochMs) {
    const minutes = Math.max(1, Math.ceil((Number(row.locked_until) - epochMs) / 60_000));
    return { ok: false, error: "signin_locked", minutes };
  }
  if (!row.verified) return { ok: false, error: "unverified", email: row.email };
  if (!verifyPassword(password, row.password_hash)) {
    const failures = row.signin_failures + 1;
    if (failures >= config.limits.SIGNIN_MAX_FAILURES) {
      // The failure that reaches the count starts the lock.
      await db.run(`update accounts set signin_failures = 0, locked_until = $1 where id = $2`, [
        epochMs + config.limits.SIGNIN_LOCK_SECONDS * 1000,
        row.id,
      ]);
      const minutes = Math.max(1, Math.ceil(config.limits.SIGNIN_LOCK_SECONDS / 60));
      return { ok: false, error: "signin_locked", minutes };
    }
    await db.run(`update accounts set signin_failures = $1 where id = $2`, [failures, row.id]);
    return { ok: false, error: "invalid_credentials" };
  }
  await db.run(`update accounts set signin_failures = 0, locked_until = null where id = $1`, [row.id]);
  return {
    ok: true,
    account: {
      id: row.id,
      workspace_id: row.workspace_id,
      name: row.name,
      email: row.email,
      verified: row.verified,
      confirmed_date_key: row.confirmed_date_key,
      time_zone: row.time_zone,
    },
  };
}

export interface MeInfo {
  user: { id: string; name: string; email: string; time_zone: string; verified: boolean };
  trial: { days_left: number; ended: boolean };
  now: string;
}

export async function meInfo(account: AccountRow): Promise<MeInfo> {
  const trial = await trialState(account);
  const { epochMs } = await workspaceNow(account.workspace_id);
  return {
    user: { id: account.id, name: account.name, email: account.email, time_zone: account.time_zone, verified: account.verified },
    trial,
    now: new Date(epochMs).toISOString(),
  };
}

export function ensureAccount(account: AccountRow | null): AccountRow {
  if (!account) throw bad("unauthenticated");
  return account;
}

export function isValidationError(err: unknown): err is ValidationError {
  return err instanceof ValidationError;
}
