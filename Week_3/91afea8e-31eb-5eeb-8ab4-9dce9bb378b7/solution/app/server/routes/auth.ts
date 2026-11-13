import type { Hono } from "hono";
import { config } from "../config.js";
import { one, query, transaction } from "../db.js";
import { ApiError, FIELD, validationFailed } from "../errors.js";
import { ok, route, type Reply, type Request } from "../http.js";
import { publicId, secretToken } from "../id.js";
import { hashPassword, verifyPassword } from "../password.js";
import { checkCode, countSend, issueCode, resendWait, type CodePurpose } from "../services/codes.js";
import { sendText, type SmsTemplate } from "../services/gateway.js";
import { ProviderUnavailable } from "../services/provider.js";
import { clearedCookie, COOKIE, cookieHeader, endAllSessions, endSession, issueSession, refreshAccess, rotateSession, type Role } from "../session.js";
import { Body, noFields } from "../validate.js";

const PENDING_TTL_SECONDS = 600;
const PHONE = /^\+91[6-9]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COPY = {
  codeSent: "If this number can be used, we'll text a 6-digit code to it.",
  stepOnePassed: "Enter the 6-digit code we sent to your phone.",
} as const;

interface AccountRow {
  id: string;
  role: Role;
  name: string;
  first_name: string;
  email: string;
  phone: string;
  password_hash: string;
}

export function accountView(row: Pick<AccountRow, "id" | "name" | "first_name" | "role">): Record<string, unknown> {
  return { id: row.id, name: row.name, first_name: row.first_name, role: row.role };
}

async function accountByIdentifier(identifier: string): Promise<AccountRow | undefined> {
  return one<AccountRow>("SELECT * FROM accounts WHERE lower(email) = lower($1) OR phone = $1", [identifier]);
}

function identifierBody(req: Request): string {
  const body = new Body(req.json(), ["identifier"]);
  const identifier = body.text("identifier", { label: "Email or phone", max: 254 });
  body.done();
  if (identifier === undefined || !(PHONE.test(identifier) || EMAIL.test(identifier))) throw validationFailed({ identifier: FIELD.badEmail });
  return identifier;
}

const DUMMY_HASH = await hashPassword("not-a-real-password");

async function deliver(phone: string, template: SmsTemplate, code: string | null): Promise<void> {
  try {
    await sendText(phone, template, code);
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw new ApiError(503, "sms_unavailable");
    throw error;
  }
}

function pendingCookie(id: string): string {
  return cookieHeader(COOKIE.pending, id, PENDING_TTL_SECONDS);
}

interface HalfSignedInRow {
  id: string;
  kind: "signup" | "signin";
  account_id: string | null;
  identifier: string;
  phone: string;
  payload: { name: string; email: string; passwordHash: string; existing: boolean } | null;
}

async function halfSignedInFor(req: Request): Promise<HalfSignedInRow | undefined> {
  const id = req.cookies[COOKIE.pending];
  if (!id) return undefined;
  return one<HalfSignedInRow>("SELECT * FROM half_signed_in_sessions WHERE id = $1 AND expires_at > $2", [id, req.nowMs]);
}

async function signup(req: Request): Promise<Reply> {
  const body = new Body(req.json(), ["name", "email", "phone", "password"]);
  const name = body.text("name", { label: "Name", min: 1, max: 60 });
  const email = body.text("email", { label: "Email", min: 3, max: 254 });
  const phone = body.text("phone", { label: "Phone", max: 20 });
  const password = body.text("password", { label: "Password", min: 10, max: 128 });
  if (email !== undefined && !EMAIL.test(email)) body.fail("email", FIELD.badEmail);
  if (phone !== undefined && !PHONE.test(phone)) body.fail("phone", FIELD.badPhone);
  body.done();
  if (name === undefined || email === undefined || phone === undefined || password === undefined) throw validationFailed({});
  await countSend(phone, req.nowMs);
  const existing = await one<{ id: string }>("SELECT id FROM accounts WHERE lower(email) = lower($1) OR phone = $2", [email, phone]);
  const pendingId = secretToken();
  const payload = { name, email, passwordHash: await hashPassword(password), existing: existing !== undefined };
  await query(
    "INSERT INTO half_signed_in_sessions (id, kind, account_id, identifier, phone, payload, expires_at) VALUES ($1, 'signup', NULL, $2, $2, $3, $4)",
    [pendingId, phone, JSON.stringify(payload), req.nowMs + PENDING_TTL_SECONDS * 1000],
  );
  try {
    if (existing) await deliver(phone, "signup_existing", null);
    else await deliver(phone, "signup_code", await issueCode(pendingId, "signup", req.nowMs));
  } catch (error) {
    await query("DELETE FROM half_signed_in_sessions WHERE id = $1", [pendingId]);
    throw error;
  }
  return { status: 202, json: { status: "code_sent", message: COPY.codeSent }, cookies: [pendingCookie(pendingId)] };
}

async function finishVerify(req: Request, kind: "signup" | "signin", status: number): Promise<Reply> {
  const body = new Body(req.json(), ["code"]);
  const code = body.text("code", { label: "Code", max: 12 });
  body.done();
  const pending = await halfSignedInFor(req);
  const passed = pending !== undefined && pending.kind === kind && code !== undefined && (await checkCode(pending.id, kind, code, req.nowMs));
  if (!passed || !pending) throw new ApiError(401, "invalid_code");
  const accountId = await transaction(async (client) => {
    await client.query("DELETE FROM half_signed_in_sessions WHERE id = $1", [pending.id]);
    if (kind === "signin") return pending.account_id;
    const payload = pending.payload;
    if (!payload) return null;
    const clash = await client.query("SELECT 1 FROM accounts WHERE lower(email) = lower($1) OR phone = $2", [payload.email, pending.phone]);
    if (clash.rowCount) return null;
    const id = publicId("U", 10);
    await client.query(
      "INSERT INTO accounts (id, role, name, first_name, email, phone, password_hash, created_at) VALUES ($1, 'shopper', $2, $3, $4, $5, $6, $7)",
      [id, payload.name, payload.name.split(/\s+/)[0] ?? payload.name, payload.email, pending.phone, payload.passwordHash, req.nowMs],
    );
    return id;
  });
  if (!accountId) throw new ApiError(401, "invalid_code");
  const account = await one<AccountRow>("SELECT * FROM accounts WHERE id = $1", [accountId]);
  if (!account) throw new ApiError(401, "invalid_code");
  const cookies = [...(await issueSession(account.id, req.nowMs)), clearedCookie(COOKIE.pending)];
  return { status, json: { account: accountView(account) }, cookies };
}

async function signin(req: Request): Promise<Reply> {
  const body = new Body(req.json(), ["identifier", "password"]);
  const identifier = body.text("identifier", { label: "Email or phone", min: 1, max: 254 });
  const password = body.text("password", { label: "Password", max: 128 });
  body.done();
  if (identifier === undefined || password === undefined) throw validationFailed({});
  const account = await accountByIdentifier(identifier);
  const valid = await verifyPassword(password, account?.password_hash ?? DUMMY_HASH);
  if (!account || !valid) throw new ApiError(401, "invalid_credentials");
  await countSend(identifier, req.nowMs);
  const pendingId = secretToken();
  await query(
    "INSERT INTO half_signed_in_sessions (id, kind, account_id, identifier, phone, payload, expires_at) VALUES ($1, 'signin', $2, $3, $4, NULL, $5)",
    [pendingId, account.id, identifier, account.phone, req.nowMs + PENDING_TTL_SECONDS * 1000],
  );
  try {
    await deliver(account.phone, "signin_code", await issueCode(pendingId, "signin", req.nowMs));
  } catch (error) {
    await query("DELETE FROM half_signed_in_sessions WHERE id = $1", [pendingId]);
    throw error;
  }
  return {
    status: 202,
    json: { status: "code_sent", message: COPY.stepOnePassed, resend_in: config.seconds.codeResend },
    cookies: [pendingCookie(pendingId)],
  };
}

async function resend(req: Request): Promise<Reply> {
  noFields(req.json());
  const pending = await halfSignedInFor(req);
  if (!pending) throw new ApiError(401, "signed_out");
  const wait = await resendWait(pending.identifier, req.nowMs);
  if (wait > 0) throw new ApiError(429, "resend_too_soon", {}, { retry_after: wait });
  await countSend(pending.identifier, req.nowMs);
  if (pending.kind === "signup" && pending.payload?.existing) await deliver(pending.phone, "signup_existing", null);
  else await deliver(pending.phone, pending.kind === "signup" ? "signup_code" : "signin_code", await issueCode(pending.id, pending.kind as CodePurpose, req.nowMs));
  return ok({ status: "code_sent", resend_in: config.seconds.codeResend }, 202);
}

async function forgot(req: Request): Promise<Reply> {
  const identifier = identifierBody(req);
  await countSend(identifier, req.nowMs);
  const account = await accountByIdentifier(identifier);
  if (account) {
    const code = await issueCode(account.id, "reset", req.nowMs);
    try {
      await sendText(account.phone, "reset_code", code);
    } catch (error) {
      // brief: forgot-password never answers 503; a code the gateway refused simply never arrives.
      if (!(error instanceof ProviderUnavailable)) throw error;
    }
  }
  return ok({ status: "code_sent", message: COPY.codeSent }, 202);
}

async function reset(req: Request): Promise<Reply> {
  const body = new Body(req.json(), ["identifier", "code", "new_password"]);
  const identifier = body.text("identifier", { label: "Email or phone", min: 1, max: 254 });
  const code = body.text("code", { label: "Code", max: 12 });
  const next = body.text("new_password", { label: "Password", min: 10, max: 128 });
  body.done();
  if (identifier === undefined || code === undefined || next === undefined) throw validationFailed({});
  const account = await accountByIdentifier(identifier);
  const passed = account !== undefined && (await checkCode(account.id, "reset", code, req.nowMs));
  if (!passed || !account) throw new ApiError(401, "invalid_code");
  await query("UPDATE accounts SET password_hash = $2 WHERE id = $1", [account.id, await hashPassword(next)]);
  await endAllSessions(account.id);
  return ok({ status: "password_reset" });
}

async function refresh(req: Request): Promise<Reply> {
  noFields(req.json());
  const cookies = await refreshAccess(req.cookies[COOKIE.session], req.nowMs);
  if (!cookies) throw new ApiError(401, "signed_out");
  return { status: 200, json: { status: "refreshed" }, cookies };
}

async function signout(req: Request): Promise<Reply> {
  noFields(req.json());
  const session = req.cookies[COOKIE.session];
  if (session) await endSession(session);
  return { status: 204, cookies: [clearedCookie(COOKIE.session), clearedCookie(COOKIE.access)] };
}

export async function changePassword(req: Request): Promise<Reply> {
  const actor = req.actor;
  if (!actor) throw new ApiError(401, "signed_out");
  const body = new Body(req.json(), ["current_password", "new_password"]);
  const current = body.text("current_password", { label: "Password", max: 128 });
  const next = body.text("new_password", { label: "Password", min: 10, max: 128 });
  body.done();
  const account = await one<AccountRow>("SELECT * FROM accounts WHERE id = $1", [actor.accountId]);
  if (current === undefined || next === undefined || !account) throw validationFailed({});
  if (!(await verifyPassword(current, account.password_hash))) throw validationFailed({ current_password: FIELD.wrongCurrentPassword });
  await query("UPDATE accounts SET password_hash = $2 WHERE id = $1", [account.id, await hashPassword(next)]);
  const cookies = await rotateSession(account.id, req.nowMs);
  return { status: 200, json: { status: "password_changed" }, cookies };
}

export function registerAuth(app: Hono): void {
  route(app, ["POST"], "/api/auth/signup", { access: "public" }, signup);
  route(app, ["POST"], "/api/auth/signup/verify", { access: "public" }, (req) => finishVerify(req, "signup", 201));
  route(app, ["POST"], "/api/auth/signin", { access: "public" }, signin);
  route(app, ["POST"], "/api/auth/signin/verify", { access: "public" }, (req) => finishVerify(req, "signin", 200));
  route(app, ["POST"], "/api/auth/code/resend", { access: "public" }, resend);
  route(app, ["POST"], "/api/auth/password/forgot", { access: "public" }, forgot);
  route(app, ["POST"], "/api/auth/password/reset", { access: "public" }, reset);
  route(app, ["POST"], "/api/auth/refresh", { access: "public" }, refresh);
  route(app, ["POST"], "/api/auth/signout", { access: "public" }, signout);
}
