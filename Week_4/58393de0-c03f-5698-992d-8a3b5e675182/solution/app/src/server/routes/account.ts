import { randomUUID } from "node:crypto";
import { copy } from "../../shared/copy";
import { PASSWORD_MAX, PASSWORD_MIN } from "../../shared/limits";
import { isValidName } from "../../shared/rules";
import type { Account, SessionView } from "../../shared/types";
import {
  ACCOUNT_COLUMNS, cookieHeader, endSession, hashPassword, identify, passwordMatches, requirePrincipal, SESSION_COOKIE,
  spendPasswordCheck, startSession,
} from "../auth";
import { sha256Hex } from "../digest";
import { serverNow } from "../clock";
import { first, isUniqueViolation, pool, withTransaction } from "../db";
import { ApiError, assertNoFieldErrors, validationError } from "../errors";
import type { Route } from "../http-types";
import { bodyText } from "../input";
import { streamSequence } from "../stream-hub";
import { RESEND_WINDOW_SECONDS, sendVerificationEmail } from "../verification";

const EMAIL_FORM = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

async function emailTaken(email: string): Promise<boolean> {
  return Boolean(await first(pool, "SELECT 1 FROM accounts WHERE lower(email) = lower($1)", [email]));
}

const signUp: Route = {
  method: "POST",
  pattern: "/api/auth/signup",
  withoutSession: true,
  async handler(req) {
    const body = req.jsonObject();
    const email = bodyText(body.email).trim();
    const displayName = bodyText(body.displayName).trim();
    const password = bodyText(body.password);
    const kind = body.accountType === "educator" || body.accountType === "personal" ? body.accountType : undefined;
    if (email && await emailTaken(email)) throw new ApiError("email_taken");

    const fields: Record<string, string> = {};
    if (!EMAIL_FORM.test(email) || email.length > EMAIL_MAX) fields.email = copy.emailInvalid;
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) fields.password = copy.passwordShort;
    if (!isValidName(displayName)) fields.displayName = copy.nameInvalid;
    if (!kind) fields.accountType = copy.validation;
    assertNoFieldErrors(fields);
    if (!kind) throw validationError(fields);

    const account: Account = {
      id: randomUUID(), kind, displayName, email, emailVerified: false, classroomId: null, nickname: null,
    };
    try {
      await pool.query(
        `INSERT INTO accounts (id, kind, display_name, email, password_hash, email_verified, created_at) VALUES ($1, $2, $3, $4, $5, false, $6)`,
        [account.id, account.kind, displayName, email, await hashPassword(password), serverNow()],
      );
    } catch (error) {
      throw isUniqueViolation(error) ? new ApiError("email_taken") : error;
    }
    const cookie = await startSession(req, { accountId: account.id });
    const verificationEmailSent = await sendVerificationEmail(pool, { id: account.id, email });
    return { status: 201, body: { account, verificationEmailSent }, headers: { "Set-Cookie": cookie } };
  },
};

const signIn: Route = {
  method: "POST",
  pattern: "/api/auth/signin",
  withoutSession: true,
  async handler(req) {
    const body = req.jsonObject();
    const email = bodyText(body.email).trim();
    const password = bodyText(body.password);
    const found = await first<Account & { passwordHash: string }>(pool,
      `SELECT ${ACCOUNT_COLUMNS}, a.password_hash AS "passwordHash" FROM accounts a WHERE lower(a.email) = lower($1)`, [email]);
    if (!found) {
      await spendPasswordCheck(password);
      throw new ApiError("bad_credentials");
    }
    const { passwordHash, ...account } = found;
    if (!await passwordMatches(password, passwordHash)) throw new ApiError("bad_credentials");
    return { status: 200, body: { account }, headers: { "Set-Cookie": await startSession(req, { accountId: account.id }) } };
  },
};

const signOut: Route = {
  method: "POST",
  pattern: "/api/auth/signout",
  withoutSession: true,
  async handler(req) {
    const identity = await identify(req.cookie(SESSION_COOKIE));
    if (identity.kind === "account" || identity.kind === "pending") await endSession(identity.sessionHash);
    return { status: 204, headers: { "Set-Cookie": cookieHeader("", 0) } };
  },
};

const session: Route = {
  method: "GET",
  pattern: "/api/session",
  withoutSession: true,
  async handler(req) {
    const identity = await identify(req.cookie(SESSION_COOKIE));
    const view: SessionView = { account: null, pendingJoin: null, streamSequence: streamSequence() };
    if (identity.kind === "account") view.account = identity.account;
    if (identity.kind === "pending") {
      const classroom = await first<{ name: string }>(pool, "SELECT name FROM classrooms WHERE id = $1", [identity.classroomId]);
      if (classroom) view.pendingJoin = { classroomName: classroom.name };
    }
    return { status: 200, body: view };
  },
};

const verify: Route = {
  method: "POST",
  pattern: "/api/auth/verify",
  withoutSession: true,
  async handler(req) {
    const token = bodyText(req.jsonObject().token);
    const account = await withTransaction(async (client) => {
      const used = await first<{ accountId: string }>(client,
        `DELETE FROM verification_tokens WHERE token_hash = $1 AND expires_at > $2 RETURNING account_id AS "accountId"`,
        [sha256Hex(token), serverNow()]);
      if (!used) return null;
      return first<Account>(client,
        `UPDATE accounts a SET email_verified = true WHERE a.id = $1 RETURNING ${ACCOUNT_COLUMNS}`, [used.accountId]);
    });
    if (!account) throw new ApiError("link_expired");
    return { status: 200, body: { account } };
  },
};

const resend: Route = {
  method: "POST",
  pattern: "/api/auth/resend-verification",
  async handler(req) {
    const { account } = await requirePrincipal(req);
    if (account.email === null) throw new ApiError("forbidden");
    const email = account.email;
    await withTransaction(async (client) => {
      const row = await first<{ sentAt: Date | null; emailVerified: boolean }>(client,
        `SELECT verification_sent_at AS "sentAt", email_verified AS "emailVerified" FROM accounts WHERE id = $1 FOR UPDATE`, [account.id]);
      const waitMs = row?.sentAt ? row.sentAt.getTime() + RESEND_WINDOW_SECONDS * 1000 - serverNow().getTime() : 0;
      if (waitMs > 0) throw new ApiError("rate_limited", { retryAfterSeconds: Math.min(RESEND_WINDOW_SECONDS, Math.ceil(waitMs / 1000)) });
      if (row?.emailVerified) throw new ApiError("already_verified");
      if (!await sendVerificationEmail(client, { id: account.id, email })) throw new ApiError("mail_unavailable");
    });
    return { status: 202, body: { sentTo: email } };
  },
};

export const accountRoutes: Route[] = [signUp, signIn, signOut, session, verify, resend];
