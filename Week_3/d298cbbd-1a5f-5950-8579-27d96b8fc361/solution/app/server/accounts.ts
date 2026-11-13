import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS } from "../shared/protocol";
import type { Account, Settings } from "../shared/protocol";
import { SIGN_IN_FAILURES_ALLOWED, SIGN_IN_WINDOW_SECONDS } from "./config";
import { pool, transaction } from "./db";
import { clearedCookie, hashPassword, openSession, passwordMatches, sessionCookie } from "./auth";
import type { Viewer } from "./auth";
import { fail, isRecord, json } from "./http";
import type { Reply } from "./http";
import { deliver, hashToken, queueLinkMail } from "./mail";
import { personalBestsOf } from "./boards";
import { dropTypistConnections } from "./live";

const NAME_MESSAGE = "Display name must be 1 to 24 characters.";
const EMAIL_MESSAGE = "Enter a valid email address.";
const PASSWORD_MESSAGE = "Password must be at least 10 characters.";
const MIN_PASSWORD = 10;
const MAX_NAME = 24;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function validEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]*\.[^@\s]*$/.test(email);
}

function invalidFields(errors: Record<string, string>): Reply {
  return fail(422, "invalid_fields", { errors });
}

export async function signUp(body: unknown): Promise<Reply> {
  const input = isRecord(body) ? body : {};
  const name = text(input.name).trim();
  const email = text(input.email).trim();
  const password = text(input.password);
  const emailKey = email.toLowerCase();
  const taken = await pool.query("SELECT 1 FROM typists WHERE email_key = $1", [emailKey]);
  if (taken.rows.length > 0) return fail(409, "email_taken");
  const errors: Record<string, string> = {};
  if ([...name].length < 1 || [...name].length > MAX_NAME) errors.name = NAME_MESSAGE;
  if (!validEmail(email)) errors.email = EMAIL_MESSAGE;
  if ([...password].length < MIN_PASSWORD) errors.password = PASSWORD_MESSAGE;
  if (Object.keys(errors).length > 0) return invalidFields(errors);
  const passwordHash = await hashPassword(password);
  const created = await transaction(async (client) => {
    const id = randomUUID();
    const inserted = await client.query("INSERT INTO typists (id, name, email, email_key, password_hash) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email_key) DO NOTHING", [id, name, email, emailKey, passwordHash]);
    if (inserted.rowCount === 0) return null;
    const mailId = await queueLinkMail(client, id, email, "verify");
    return { id, mailId, token: await openSession(client, id) };
  });
  if (!created) return fail(409, "email_taken");
  const sent = await deliver(created.mailId);
  return json(201, { id: created.id, email, verified: false, mail: sent ? "sent" : "retrying" }, { "Set-Cookie": sessionCookie(created.token) });
}

export async function verifyEmail(body: unknown): Promise<Reply> {
  const token = isRecord(body) ? text(body.token) : "";
  const verified = await transaction(async (client) => {
    const used = await client.query<{ typist_id: string }>(
      "UPDATE link_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = 'verify' AND used_at IS NULL AND expires_at > now() RETURNING typist_id",
      [hashToken(token)],
    );
    const row = used.rows[0];
    if (!row) return false;
    await client.query("UPDATE typists SET verified = true WHERE id = $1", [row.typist_id]);
    return true;
  });
  return verified ? json(200, { verified: true }) : fail(410, "link_expired");
}

/** Counts failures per email under an advisory lock, so parallel attempts are counted exactly. */
export async function signIn(body: unknown): Promise<Reply> {
  const input = isRecord(body) ? body : {};
  const emailKey = text(input.email).trim().toLowerCase();
  const password = text(input.password);
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [emailKey]);
    await client.query("DELETE FROM sign_in_failures WHERE email_key = $1 AND failed_at <= now() - make_interval(secs => $2)", [emailKey, SIGN_IN_WINDOW_SECONDS]);
    const recent = await client.query<{ retry_after: number }>(
      "SELECT ceil(extract(epoch FROM (min(failed_at) + make_interval(secs => $2) - now())))::int AS retry_after, count(*)::int AS failures FROM sign_in_failures WHERE email_key = $1 HAVING count(*) >= $3",
      [emailKey, SIGN_IN_WINDOW_SECONDS, SIGN_IN_FAILURES_ALLOWED],
    );
    if (recent.rows[0]) return fail(429, "too_many_attempts", { retryAfter: Math.max(1, recent.rows[0].retry_after) });
    const found = await client.query<{ id: string; name: string; verified: boolean; password_hash: string }>("SELECT id, name, verified, password_hash FROM typists WHERE email_key = $1", [emailKey]);
    const typist = found.rows[0];
    if (!typist || !(await passwordMatches(password, typist.password_hash))) {
      await client.query("INSERT INTO sign_in_failures (email_key) VALUES ($1)", [emailKey]);
      return fail(401, "invalid_credentials");
    }
    const token = await openSession(client, typist.id);
    return json(200, { id: typist.id, name: typist.name, verified: typist.verified }, { "Set-Cookie": sessionCookie(token) });
  });
}

export async function requestReset(body: unknown): Promise<Reply> {
  const emailKey = isRecord(body) ? text(body.email).trim().toLowerCase() : "";
  const found = await pool.query<{ id: string; email: string }>("SELECT id, email FROM typists WHERE email_key = $1", [emailKey]);
  const typist = found.rows[0];
  if (typist) {
    const mailId = await queueLinkMail(pool, typist.id, typist.email, "reset");
    void deliver(mailId).catch(() => undefined);
  }
  return json(202, { status: "accepted" });
}

/** Sets a new password with a single-use link and ends every session of the typist, the caller's included. */
export async function confirmReset(body: unknown): Promise<Reply> {
  const input = isRecord(body) ? body : {};
  const tokenHash = hashToken(text(input.token));
  const live = await pool.query("SELECT 1 FROM link_tokens WHERE token_hash = $1 AND purpose = 'reset' AND used_at IS NULL AND expires_at > now()", [tokenHash]);
  if (live.rows.length === 0) return fail(410, "link_expired");
  const password = text(input.password);
  if ([...password].length < MIN_PASSWORD) return invalidFields({ password: PASSWORD_MESSAGE });
  const passwordHash = await hashPassword(password);
  const typistId = await transaction(async (client) => {
    const used = await client.query<{ typist_id: string }>(
      "UPDATE link_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = 'reset' AND used_at IS NULL AND expires_at > now() RETURNING typist_id",
      [tokenHash],
    );
    const row = used.rows[0];
    if (!row) return null;
    await client.query("UPDATE typists SET password_hash = $2 WHERE id = $1", [row.typist_id, passwordHash]);
    await client.query("DELETE FROM sessions WHERE typist_id = $1", [row.typist_id]);
    return row.typist_id;
  });
  if (!typistId) return fail(410, "link_expired");
  dropTypistConnections(typistId);
  return json(200, { status: "changed" }, { "Set-Cookie": clearedCookie });
}

export function me(viewer: Viewer): Reply {
  return json(200, { id: viewer.typistId, name: viewer.name, verified: viewer.verified });
}

function settingsErrors(input: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const oneOf = (field: string, allowed: readonly unknown[]): void => {
    if (!allowed.includes(input[field])) errors[field] = `${field} is not allowed.`;
  };
  oneOf("theme", ["sand", "cobalt", "carbon", "ledger"]);
  oneOf("caret", ["line", "block", "underline", "off"]);
  oneOf("smoothCaret", [true, false]);
  oneOf("fontSize", [1, 1.5, 2, 3]);
  oneOf("blindMode", [true, false]);
  oneOf("quickRestart", ["tab", "enter"]);
  return errors;
}

export async function readSettings(viewer: Viewer): Promise<Reply> {
  const { rows } = await pool.query<{ settings: Settings | null }>("SELECT settings FROM typists WHERE id = $1", [viewer.typistId]);
  return json(200, rows[0]?.settings ?? DEFAULT_SETTINGS);
}

export async function writeSettings(viewer: Viewer, body: unknown): Promise<Reply> {
  const input = isRecord(body) ? body : {};
  const errors = settingsErrors(input);
  if (Object.keys(errors).length > 0) return invalidFields(errors);
  const stored: Settings = {
    theme: input.theme as Settings["theme"],
    caret: input.caret as Settings["caret"],
    smoothCaret: input.smoothCaret as boolean,
    fontSize: input.fontSize as Settings["fontSize"],
    blindMode: input.blindMode as boolean,
    quickRestart: input.quickRestart as Settings["quickRestart"],
  };
  await pool.query("UPDATE typists SET settings = $2 WHERE id = $1", [viewer.typistId, JSON.stringify(stored)]);
  return json(200, stored);
}

export async function accountOf(viewer: Viewer): Promise<Reply> {
  const { rows } = await pool.query<{ email: string }>("SELECT email FROM typists WHERE id = $1", [viewer.typistId]);
  const counted = await pool.query<{ total: number }>("SELECT count(*)::int AS total FROM runs WHERE typist_id = $1 AND verdict = 'counted'", [viewer.typistId]);
  const account: Account = {
    name: viewer.name,
    email: rows[0]!.email,
    verified: viewer.verified,
    testsCounted: counted.rows[0]!.total,
    personalBests: await personalBestsOf(viewer.typistId),
  };
  return json(200, account);
}
