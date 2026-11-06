// Sign-in, the code step and each user's own account: two-step sign-in, sessions and password
// (brief: API, Session and identity; Account; Business rules, Sign-in throttling, Two-step sign-in,
// Pending sessions and the code step, Step-up confirmation, Sessions, Password change).
import { createHmac, randomBytes } from "node:crypto";
import type pg from "pg";
import {
  caller, CLEARED_COOKIE, moveSessions, requireActive, sessionCookie, sessionLive, sessionToken, USER_COLUMNS, type Role, type Session, type User,
} from "./access.js";
import { appendAuditForUser } from "./audit.js";
import { config } from "./config.js";
import { one, pool, query, row, tx, type Db } from "./db.js";
import { ApiError, invalid, rateLimited, transition } from "./errors.js";
import { fieldErrors, header, isoOrNull, isoSecond, readJson, secondsUntil, sendJson, sendNoContent, truncateToSecond, type Ctx, type JsonObject } from "./http.js";
import { passwordAllowed, SIGNIN_FAILURES_MAX } from "./limits.js";
import { enqueueMail, wakeMail } from "./mail.js";
import {
  hashPassword, newRecoveryCode, normalizeRecoveryCode, passwordMatches, randomToken, recoveryCodeHash, seal, sha256Hex, unseal,
} from "./secrets.js";
import { formatCount, formatTime } from "../shared/format.js";

export const requireCsrfHeader = (ctx: Ctx): void => {
  if (header(ctx, "x-requested-with") !== "farshore") throw new ApiError("forbidden", "Send X-Requested-With: farshore with every change.");
};

// ---- Throttle: failures per email, case-insensitive, whether or not an account exists ----

export async function throttle(ctx: Ctx, email: string): Promise<void> {
  const since = new Date(ctx.now.getTime() - config.signinWindowSeconds * 1000);
  const failures = await query<{ failed_at: Date }>(pool,
    "SELECT failed_at FROM signin_failures WHERE email = $1 AND failed_at > $2 ORDER BY failed_at", [email.toLowerCase(), since]);
  const oldest = failures[0];
  if (failures.length >= SIGNIN_FAILURES_MAX && oldest) {
    throw rateLimited(secondsUntil(ctx.now, new Date(oldest.failed_at.getTime() + config.signinWindowSeconds * 1000)));
  }
}

// A wrong password or code: one failure counts for the email it was submitted for, the account's
// failed sign-in is audited when the attempt was a sign-in, and the refusal is thrown.
export async function refuseAttempt(ctx: Ctx, email: string, refusal: ApiError,
                                    failedSignIn?: { user: Pick<User, "id" | "email">; detail: "password" | "two-step code" }): Promise<never> {
  await tx(async (client) => {
    await client.query("INSERT INTO signin_failures (email, failed_at) VALUES ($1, $2)", [email.toLowerCase(), ctx.now]);
    if (failedSignIn) {
      const { user, detail } = failedSignIn;
      await appendAuditForUser(client, user.id, { actor: user.email, action: "session.sign_in_failed", target: user.email, detail }, ctx.now);
    }
  });
  throw refusal;
}

// A completed sign-in clears the email's failures, is audited when it came through the sign-in
// steps, and issues a new active session.
export async function completeSignIn(client: Db, ctx: Ctx, user: Pick<User, "id" | "email">,
                                     detail: "password" | "two-step" | "recovery code" | null): Promise<{ token: string; session: Session }> {
  await client.query("DELETE FROM signin_failures WHERE email = $1", [user.email.toLowerCase()]);
  if (detail) {
    await appendAuditForUser(client, user.id, { actor: user.email, action: "session.signed_in", target: user.email, detail }, ctx.now);
  }
  return moveSessions(client, { to: "active", ctx, userId: user.id });
}

// For the endpoints whose throttle is judged before X-Requested-With and authentication.
async function throttleCaller(ctx: Ctx): Promise<void> {
  const who = await caller(ctx);
  if (who.kind === "active" || who.kind === "pending") await throttle(ctx, who.user.email);
  requireCsrfHeader(ctx);
}

// ---- Sessions ----

// Sign-in replacement: the session named by the incoming cookie ends in the same change.
async function endIncomingSession(client: Db, ctx: Ctx): Promise<void> {
  const token = sessionToken(ctx);
  if (token) await moveSessions(client, { to: "ended", by: { tokenHash: sha256Hex(token) } });
}

// Ends every other live session of a user, pending ones included; answers how many ended.
async function endOtherSessions(client: Db, userId: string, keepId: string, now: Date): Promise<number> {
  const others = await query<Session>(client,
    "SELECT * FROM sessions WHERE user_id = $1 AND id <> $2 AND state <> 'ended' FOR UPDATE", [userId, keepId]);
  await moveSessions(client, { to: "ended", by: { ids: others.map((s) => s.id) } });
  return others.filter((s) => sessionLive(s, now)).length;
}

export async function sessionBody(db: Db, user: User): Promise<Record<string, unknown>> {
  const memberships = await query<{ slug: string; name: string; role: Role }>(db,
    `SELECT w.slug, w.name, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = $1 ORDER BY w.name, w.slug`, [user.id]);
  return {
    user: { id: user.id, name: user.name, email: user.email, operator: user.operator },
    memberships: memberships.map((m) => ({ workspace: { slug: m.slug, name: m.name }, role: m.role })),
  };
}

// ---- Authenticator codes (RFC 6238) and recovery codes ----

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function totp(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// The authenticator code check, with the user's one last accepted step shared by sign-in,
// step-up confirmation, enabling and turning off. Locks the user row for the rest of the change.
async function acceptAuthenticatorCode(client: pg.PoolClient, userId: string, sealedSecret: string, code: unknown, now: Date): Promise<boolean> {
  const user = await row<{ last_totp_step: number | null }>(client, "SELECT last_totp_step FROM users WHERE id = $1 FOR UPDATE", [userId]);
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(unseal(sealedSecret));
  const current = Math.floor(now.getTime() / 30_000);
  for (const step of [current - 1, current, current + 1]) {
    if (step > (user.last_totp_step ?? -1) && totp(secret, step) === code) {
      await client.query("UPDATE users SET last_totp_step = $2 WHERE id = $1", [userId, step]);
      return true;
    }
  }
  return false;
}


async function acceptRecoveryCode(client: pg.PoolClient, userId: string, code: unknown): Promise<boolean> {
  await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
  if (typeof code !== "string" || !/^[a-z0-9]{10}$/.test(normalizeRecoveryCode(code))) return false;
  const used = await one(client,
    "UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING 1",
    [userId, recoveryCodeHash(code)]);
  return used !== undefined;
}

const EITHER_CODE = "Enter a code from your app or a recovery code.";
const WRONG_CODE = "That code didn't work. Use the current code from your app.";
const WRONG_RECOVERY = "That recovery code didn't work or was already used.";

// Exactly one of code or recovery_code, and no other field.
function codeBody(body: JsonObject): { code?: unknown; recovery?: unknown } {
  const errors = fieldErrors(body, ["code", "recovery_code"], []);
  if (("code" in body) === ("recovery_code" in body)) errors.code = EITHER_CODE;
  if (Object.keys(errors).length) throw invalid(errors);
  return "code" in body ? { code: body.code } : { recovery: body.recovery_code };
}

interface EnrolledUser {
  id: string;
  email: string;
  two_step_secret: string | null;
  two_step_setup: string | null;
  two_step_enabled_at: Date | null;
}

const enrolment = async (db: Db, userId: string): Promise<EnrolledUser> =>
  row<EnrolledUser>(db, "SELECT id, email, two_step_secret, two_step_setup, two_step_enabled_at FROM users WHERE id = $1", [userId]);

// Judges a code or recovery code for an enrolled user inside `client`'s change.
async function judgeCode(client: pg.PoolClient, user: EnrolledUser, given: { code?: unknown; recovery?: unknown }, now: Date): Promise<boolean> {
  if ("code" in given) return acceptAuthenticatorCode(client, user.id, user.two_step_secret ?? "", given.code, now);
  return acceptRecoveryCode(client, user.id, given.recovery);
}

// ---- Sign-in ----

// Compared against when no account exists, so known and unknown emails cost the same.
const DUMMY_HASH = hashPassword(randomToken(16));

export async function signIn(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    throw invalid({
      ...(typeof body.email === "string" ? {} : { email: "This field is required." }),
      ...(typeof body.password === "string" ? {} : { password: "This field is required." }),
    });
  }
  const email = body.email.trim();
  await throttle(ctx, email);
  requireCsrfHeader(ctx);
  const account = await one<User & { password_hash: string }>(pool,
    `SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE lower(u.email) = lower($1)`, [email]);
  const ok = await passwordMatches(body.password, account?.password_hash ?? await DUMMY_HASH);
  if (!account || !ok) {
    return refuseAttempt(ctx, email, new ApiError("invalid_credentials"), account ? { user: account, detail: "password" } : undefined);
  }
  const extra = fieldErrors(body, ["email", "password"], []);
  if (Object.keys(extra).length) throw invalid(extra);
  const issued = await tx(async (client) => {
    await endIncomingSession(client, ctx);
    if (account.two_step_enabled_at) return moveSessions(client, { to: "pending", ctx, userId: account.id });
    return completeSignIn(client, ctx, account, "password");
  });
  const cookie = { "Set-Cookie": sessionCookie(issued.token) };
  if (issued.session.state === "pending") {
    sendJson(ctx, 202, { two_step: "required", expires_at: isoOrNull(issued.session.pending_until) }, cookie);
    return;
  }
  sendJson(ctx, 200, await sessionBody(pool, account), cookie);
}

// The code step: only a live pending session reaches it. An accepted code ends the pending session
// and issues a new active one in the same change.
export async function codeStep(ctx: Ctx): Promise<void> {
  await throttleCaller(ctx);
  const who = await caller(ctx);
  if (who.kind !== "pending") throw new ApiError("unauthenticated");
  const given = codeBody(await readJson(ctx));
  const user = await enrolment(pool, who.user.id);
  const issued = await tx(async (client) => {
    if (!(await judgeCode(client, user, given, ctx.now))) return null;
    // The pending session is promoted only if it is still pending and live at this write.
    const promoted = await moveSessions(client, { to: "ended", by: { ids: [who.session.id] }, pendingAt: ctx.now });
    if (!promoted.length) throw new ApiError("unauthenticated");
    return completeSignIn(client, ctx, user, "code" in given ? "two-step" : "recovery code");
  });
  if (!issued) return refuseAttempt(ctx, user.email, new ApiError("invalid_credentials", "That code didn't work."), { user, detail: "two-step code" });
  sendJson(ctx, 200, await sessionBody(pool, who.user), { "Set-Cookie": sessionCookie(issued.token) });
}

export async function signOut(ctx: Ctx): Promise<void> {
  const token = sessionToken(ctx);
  if (token) await moveSessions(pool, { to: "ended", by: { tokenHash: sha256Hex(token) } });
  ctx.res.setHeader("Set-Cookie", CLEARED_COOKIE);
  sendNoContent(ctx);
}

export async function me(ctx: Ctx): Promise<void> {
  sendJson(ctx, 200, await sessionBody(pool, await requireActive(ctx).then((a) => a.user)));
}

// ---- Two-step sign-in: off → setup → on → off ----

async function twoStepMail(client: Db, email: string, on: boolean, at: Date): Promise<void> {
  await enqueueMail(client, email, `Two-step sign-in turned ${on ? "on" : "off"} for your Farshore account`, [
    `Two-step sign-in was turned ${on ? "on" : "off"} for your Farshore account at ${formatTime(at)}.`, "",
    on ? "From now on, signing in asks for a code from your authenticator app."
      : "Signing in now needs only your email and password.",
    "If this wasn't you, change your password and contact your workspace owner.",
  ].join("\n"));
}

export async function twoStepStatus(ctx: Ctx): Promise<void> {
  const { user } = await requireActive(ctx);
  const left = await row<{ n: number }>(pool, "SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL", [user.id]);
  const enrolled = await enrolment(pool, user.id);
  sendJson(ctx, 200, {
    enabled: enrolled.two_step_enabled_at !== null, enabled_at: isoOrNull(enrolled.two_step_enabled_at),
    recovery_codes_left: enrolled.two_step_enabled_at ? left.n : 0,
  });
}

export async function twoStepSetup(ctx: Ctx): Promise<void> {
  const { user } = await requireActive(ctx);
  const body = await readJson(ctx);
  if ((await enrolment(pool, user.id)).two_step_enabled_at) throw transition("on", "on");
  const extra = fieldErrors(body, [], []);
  if (Object.keys(extra).length) throw invalid(extra);
  const secret = base32Encode(randomBytes(20));
  await pool.query("UPDATE users SET two_step_setup = $2 WHERE id = $1", [user.id, seal(secret)]);
  sendJson(ctx, 200, {
    secret,
    otpauth_uri: `otpauth://totp/Farshore:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Farshore&algorithm=SHA1&digits=6&period=30`,
  });
}

export async function twoStepEnable(ctx: Ctx): Promise<void> {
  const { user } = await requireActive(ctx);
  const body = await readJson(ctx);
  const enrolled = await enrolment(pool, user.id);
  if (enrolled.two_step_enabled_at) throw transition("on", "on");
  if (!enrolled.two_step_setup) throw transition("off", "on");
  const errors = fieldErrors(body, ["code"], ["code"]);
  if (Object.keys(errors).length) throw invalid(errors);
  const setup = enrolled.two_step_setup;
  const codes = Array.from({ length: 10 }, newRecoveryCode);
  const enabled = await tx(async (client) => {
    if (!(await acceptAuthenticatorCode(client, user.id, setup, body.code, ctx.now))) return false;
    const at = truncateToSecond(ctx.now);
    // Guarded at the write: a concurrent enable that won first leaves nothing to promote.
    const promoted = await one(client,
      `UPDATE users SET two_step_secret = two_step_setup, two_step_setup = NULL, two_step_enabled_at = $2
       WHERE id = $1 AND two_step_enabled_at IS NULL AND two_step_setup = $3 RETURNING 1`, [user.id, at, setup]);
    if (!promoted) throw transition("on", "on");
    await client.query("DELETE FROM recovery_codes WHERE user_id = $1", [user.id]);
    await client.query("INSERT INTO recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])", [user.id, codes.map(recoveryCodeHash)]);
    await twoStepMail(client, user.email, true, at);
    await appendAuditForUser(client, user.id, { actor: user.email, action: "two_step.enabled", target: user.email, detail: "" }, ctx.now);
    return true;
  });
  if (!enabled) throw invalid({ code: WRONG_CODE });
  wakeMail();
  sendJson(ctx, 200, { recovery_codes: codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`) });
}

// Judges a code for turning two-step off or confirming; a wrong one counts as a failure.
async function withCode<T>(ctx: Ctx, user: EnrolledUser, given: { code?: unknown; recovery?: unknown },
                           then: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const result = await tx(async (client) => ((await judgeCode(client, user, given, ctx.now)) ? { value: await then(client) } : null));
  if (!result) return refuseAttempt(ctx, user.email, invalid("code" in given ? { code: WRONG_CODE } : { recovery_code: WRONG_RECOVERY }));
  return result.value;
}

export async function twoStepDisable(ctx: Ctx): Promise<void> {
  await throttleCaller(ctx);
  const { user } = await requireActive(ctx);
  const body = await readJson(ctx);
  const enrolled = await enrolment(pool, user.id);
  if (!enrolled.two_step_enabled_at) throw transition("off", "off");
  const given = codeBody(body);
  await withCode(ctx, enrolled, given, async (client) => {
    const turnedOff = await one(client,
      `UPDATE users SET two_step_secret = NULL, two_step_setup = NULL, two_step_enabled_at = NULL
       WHERE id = $1 AND two_step_enabled_at IS NOT NULL RETURNING 1`, [user.id]);
    if (!turnedOff) throw transition("off", "off");
    await client.query("DELETE FROM recovery_codes WHERE user_id = $1", [user.id]);
    await twoStepMail(client, user.email, false, truncateToSecond(ctx.now));
    await appendAuditForUser(client, user.id, { actor: user.email, action: "two_step.disabled", target: user.email, detail: "" }, ctx.now);
  });
  wakeMail();
  sendNoContent(ctx);
}

// Step-up confirmation for this session, lasting FARSHORE_STEP_UP_SECONDS from acceptance.
export async function confirmStepUp(ctx: Ctx): Promise<void> {
  await throttleCaller(ctx);
  const { user, session } = await requireActive(ctx);
  const body = await readJson(ctx);
  const enrolled = await enrolment(pool, user.id);
  if (!enrolled.two_step_enabled_at) throw transition("off", "confirmed");
  const given = codeBody(body);
  const until = await withCode(ctx, enrolled, given, async (client) => {
    const confirmedUntil = new Date(truncateToSecond(ctx.now).getTime() + config.stepUpSeconds * 1000);
    await client.query("UPDATE sessions SET confirmed_until = $2 WHERE id = $1", [session.id, confirmedUntil]);
    return confirmedUntil;
  });
  sendJson(ctx, 200, { confirmed_until: isoSecond(until) });
}

// ---- Sessions page ----

export async function listSessions(ctx: Ctx): Promise<void> {
  const { user, session: current } = await requireActive(ctx);
  const sessions = (await query<Session>(pool,
    "SELECT * FROM sessions WHERE user_id = $1 AND state = 'active' ORDER BY last_seen_at DESC, created_at DESC, id", [user.id]))
    .filter((s) => sessionLive(s, ctx.now));
  sendJson(ctx, 200, {
    sessions: sessions.map((s) => ({
      id: s.id, device: s.device, created_at: isoSecond(s.created_at), last_seen_at: isoSecond(s.last_seen_at), current: s.id === current.id,
    })),
  });
}

export async function endSession(ctx: Ctx): Promise<void> {
  const { user, session: current } = await requireActive(ctx);
  const ended = await tx(async (client) => {
    const target = await one<Session>(client,
      "SELECT * FROM sessions WHERE id = $1 AND user_id = $2 AND state = 'active' FOR UPDATE", [ctx.params.id ?? "", user.id]);
    if (!target || !sessionLive(target, ctx.now)) throw new ApiError("not_found");
    await moveSessions(client, { to: "ended", by: { ids: [target.id] } });
    return target;
  });
  if (ended.id === current.id) ctx.res.setHeader("Set-Cookie", CLEARED_COOKIE);
  sendNoContent(ctx);
}

export async function signOutOthers(ctx: Ctx): Promise<void> {
  const { user, session } = await requireActive(ctx);
  const extra = fieldErrors(await readJson(ctx), [], []);
  if (Object.keys(extra).length) throw invalid(extra);
  sendJson(ctx, 200, { ended: await tx((client) => endOtherSessions(client, user.id, session.id, ctx.now)) });
}

// ---- Password ----

const NEW_PASSWORD_MESSAGE = "Use 12 to 128 characters, different from your current password.";

export async function changePassword(ctx: Ctx): Promise<void> {
  await throttleCaller(ctx);
  const { user, session } = await requireActive(ctx);
  const body = await readJson(ctx);
  const required = fieldErrors(body, Object.keys(body), ["current_password", "new_password"]);
  if (typeof body.current_password !== "string" || typeof body.new_password !== "string") {
    throw invalid({ ...required,
      ...(typeof body.current_password === "string" ? {} : { current_password: "This field is required." }),
      ...(typeof body.new_password === "string" ? {} : { new_password: "This field is required." }) });
  }
  const stored = await row<{ password_hash: string }>(pool, "SELECT password_hash FROM users WHERE id = $1", [user.id]);
  if (!(await passwordMatches(body.current_password, stored.password_hash))) {
    return refuseAttempt(ctx, user.email, new ApiError("invalid_credentials", "Your current password is incorrect."));
  }
  const errors = fieldErrors(body, ["current_password", "new_password"], []);
  if (!passwordAllowed(body.new_password) || body.new_password === body.current_password) errors.new_password = NEW_PASSWORD_MESSAGE;
  if (Object.keys(errors).length) throw invalid(errors);
  const hash = await hashPassword(body.new_password);
  const ended = await tx(async (client) => {
    await client.query("UPDATE users SET password_hash = $2 WHERE id = $1", [user.id, hash]);
    const count = await endOtherSessions(client, user.id, session.id, ctx.now);
    const others = count === 1 ? "1 other session was" : `${formatCount(count)} other sessions were`;
    await enqueueMail(client, user.email, "Your Farshore password was changed", [
      `Your Farshore password was changed at ${formatTime(truncateToSecond(ctx.now))}.`,
      `${others} signed out.`, "",
      "If this wasn't you, contact your workspace owner.",
    ].join("\n"));
    await appendAuditForUser(client, user.id, { actor: user.email, action: "password.changed", target: user.email, detail: "" }, ctx.now);
    return count;
  });
  wakeMail();
  sendJson(ctx, 200, { ended_sessions: ended });
}

