import { config } from '../core/config.js';
import { db, one, transaction } from '../core/db.js';
import { ApiError, errors } from '../core/errors.js';
import { hashPassword, randomToken, sha256Hex, totpMatches, verifyPassword } from '../core/crypto.js';
import { secondsUntil } from '../core/time.js';
import { sendLockoutMail, sendPasswordResetMail, sendVerificationMail } from '../services/mail.js';
import { copy } from '../shared/copy.js';
import { emitAccount } from './events.js';
import { normaliseEmail, validEmail, validPassword, validUsername } from './validation.js';
import { loadMemberById, memberColumns, toMember, type Member } from './viewer.js';

export const SESSION_COOKIE = 'mh_session';

export async function createSession(memberId: string): Promise<string> {
  const token = randomToken();
  await db.query('insert into sessions (token_hash, member_id) values ($1, $2)', [sha256Hex(token), memberId]);
  return token;
}

export interface SessionLookup {
  member: Member;
  revoked: boolean;
}

/**
 * A revoked session is signed out, except when its account is suspended: those requests must keep
 * answering 403 SUSPENDED rather than looking like a visitor.
 */
export async function memberForSession(token: string): Promise<SessionLookup | null> {
  const row = await one<Record<string, unknown>>(
    db,
    `select ${memberColumns()}, s.revoked_at from sessions s join members m on m.id = s.member_id
     where s.token_hash = $1`,
    [sha256Hex(token)],
  );
  if (!row) return null;
  return { member: toMember(row), revoked: row.revoked_at !== null };
}

export async function revokeSession(token: string): Promise<void> {
  await db.query('update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [
    sha256Hex(token),
  ]);
}

export async function revokeAllSessions(memberId: string): Promise<void> {
  await db.query('update sessions set revoked_at = now() where member_id = $1 and revoked_at is null', [memberId]);
}

export interface SignupInput {
  email: string;
  username: string;
  password: string;
}

export async function signUp(input: SignupInput): Promise<{ member: Member; token: string }> {
  const email = normaliseEmail(input.email);
  const fields: Record<string, string> = {};
  if (!validEmail(email)) fields.email = copy.signup.emailInvalid;
  if (!validUsername(input.username)) fields.username = copy.signup.usernameInvalid;
  if (!validPassword(input.password)) fields.password = copy.signup.passwordInvalid;
  if (Object.keys(fields).length > 0) throw errors.validation('Check the highlighted fields', fields);

  const taken = await db.query<{ email_taken: boolean; username_taken: boolean }>(
    `select exists (select 1 from members where email_ci = $1) as email_taken,
            exists (select 1 from members where username_ci = $2) as username_taken`,
    [email.toLowerCase(), input.username.toLowerCase()],
  );
  const state = taken.rows[0];
  const conflicts: Record<string, string> = {};
  if (state?.username_taken) conflicts.username = copy.signup.usernameTaken;
  if (state?.email_taken) conflicts.email = copy.signup.emailTaken;
  if (Object.keys(conflicts).length > 0) {
    throw new ApiError('NAME_TAKEN', 'That account already exists', { fields: conflicts });
  }

  const passwordHash = await hashPassword(input.password);
  const row = await one(
    db,
    `insert into members (username, username_ci, email, email_ci, password_hash)
     values ($1, $2, $3, $4, $5)
     returning ${memberColumns(null)}`,
    [input.username, input.username.toLowerCase(), email, email.toLowerCase(), passwordHash],
  );
  const member = toMember(row as Record<string, unknown>);
  const session = await createSession(member.id);
  await issueVerificationMail(member);
  return { member, token: session };
}

/** The mail at sign-up counts toward the resend limit. */
async function issueVerificationMail(member: Member): Promise<void> {
  const token = randomToken();
  await transaction(async (tx) => {
    await tx.query(`update email_tokens set used_at = now() where member_id = $1 and kind = 'verify' and used_at is null`, [
      member.id,
    ]);
    await tx.query(
      `insert into email_tokens (token_hash, member_id, kind, expires_at)
       values ($1, $2, 'verify', now() + make_interval(secs => $3::integer))`,
      [sha256Hex(token), member.id, config.limits.verifyLinkTtlSeconds],
    );
    await tx.query('insert into verification_sends (member_id) values ($1)', [member.id]);
  });
  await sendVerificationMail(member.email, token);
}

export async function resendVerification(member: Member): Promise<void> {
  if (member.emailVerified) throw errors.conflict('That email address is already confirmed');
  const sent = await one<{ count: string }>(
    db,
    `select count(*) as count from verification_sends
     where member_id = $1 and at > now() - make_interval(secs => $2::integer)`,
    [member.id, config.limits.verifyResendWindowSeconds],
  );
  if (Number(sent?.count ?? 0) >= config.limits.verifyResendLimit) {
    throw errors.rateLimited(copy.verify.resendLimited, config.limits.verifyResendWindowSeconds);
  }
  await issueVerificationMail(member);
}

export async function confirmVerification(token: string): Promise<Member> {
  const row = await one<{ member_id: string }>(
    db,
    `update email_tokens set used_at = now()
     where token_hash = $1 and kind = 'verify' and used_at is null and expires_at > now()
     returning member_id`,
    [sha256Hex(token)],
  );
  if (!row) throw errors.validation(copy.verify.expired, { token: copy.verify.expired });
  await db.query('update members set email_verified = true where id = $1', [row.member_id]);
  const member = await loadMemberById(db, String(row.member_id));
  if (!member) throw errors.notFound('Account not found');
  return member;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const row = await one(db, `select ${memberColumns()} from members m where m.email_ci = $1`, [
    normaliseEmail(email).toLowerCase(),
  ]);
  if (!row) return;
  const member = toMember(row);
  const token = randomToken();
  await transaction(async (tx) => {
    await tx.query(`update email_tokens set used_at = now() where member_id = $1 and kind = 'reset' and used_at is null`, [
      member.id,
    ]);
    await tx.query(
      `insert into email_tokens (token_hash, member_id, kind, expires_at)
       values ($1, $2, 'reset', now() + make_interval(secs => $3::integer))`,
      [sha256Hex(token), member.id, config.limits.resetLinkTtlSeconds],
    );
  });
  await sendPasswordResetMail(member.email, token);
}

/** A reset works once, sets the password, ends every session and signs nobody in. */
export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  if (!validPassword(newPassword)) {
    throw errors.validation(copy.signup.passwordInvalid, { newPassword: copy.signup.passwordInvalid });
  }
  const row = await one<{ member_id: string }>(
    db,
    `update email_tokens set used_at = now()
     where token_hash = $1 and kind = 'reset' and used_at is null and expires_at > now()
     returning member_id`,
    [sha256Hex(token)],
  );
  if (!row) throw errors.validation(copy.reset.expired, { token: copy.reset.expired });
  const passwordHash = await hashPassword(newPassword);
  await db.query(
    'update members set password_hash = $2, locked_until = null where id = $1',
    [row.member_id, passwordHash],
  );
  await db.query('delete from login_failures where member_id = $1', [row.member_id]);
  await revokeAllSessions(String(row.member_id));
}

export interface LoginInput {
  login: string;
  password: string;
  totp: string | null;
}

interface LoginRow extends Record<string, unknown> {
  id: string;
  password_hash: string;
  locked_until: unknown;
}

/** Failures are counted per account in a rolling window; the one that reaches the limit locks it. */
async function registerFailure(member: { id: string; email: string }): Promise<boolean> {
  const lockedOut = await transaction(async (tx) => {
    await tx.query('insert into login_failures (member_id) values ($1)', [member.id]);
    const count = await one<{ count: string }>(
      tx,
      `select count(*) as count from login_failures
       where member_id = $1 and at > now() - make_interval(secs => $2::integer)`,
      [member.id, config.limits.loginLockoutSeconds],
    );
    if (Number(count?.count ?? 0) >= config.limits.loginLockoutAttempts) {
      await tx.query(
        'update members set locked_until = now() + make_interval(secs => $2::integer) where id = $1',
        [member.id, config.limits.loginLockoutSeconds],
      );
      return true;
    }
    return false;
  });

  if (lockedOut) await sendLockoutMail(member.email);
  return lockedOut;
}

function lockoutError(): ApiError {
  return errors.rateLimited(copy.signin.lockedOut, config.limits.loginLockoutSeconds);
}

export async function signIn(input: LoginInput): Promise<{ member: Member; token: string }> {
  const identifier = input.login.trim().toLowerCase();
  const row = await one<LoginRow>(
    db,
    `select ${memberColumns()}, m.password_hash, m.locked_until
     from members m where m.email_ci = $1 or m.username_ci = $1`,
    [identifier],
  );
  if (!row) throw errors.unauthenticated(copy.signin.incorrect);

  const member = toMember(row);

  if (row.locked_until) {
    const remaining = secondsUntil(row.locked_until);
    if (remaining > 0) throw errors.rateLimited(copy.signin.lockedOut, Math.max(1, remaining));
  }

  if (!(await verifyPassword(String(row.password_hash), input.password))) {
    if (await registerFailure(member)) throw lockoutError();
    throw errors.unauthenticated(copy.signin.incorrect);
  }

  if (member.suspendedAt !== null) throw errors.suspended();

  if (member.totpEnabled && member.totpSecret) {
    if (input.totp === null || input.totp === '') {
      throw new ApiError('TOTP_REQUIRED', copy.signin.codeRequired, { status: 401 });
    }
    if (!/^[0-9]{6}$/.test(input.totp)) {
      throw errors.validation(copy.signin.codeRequired, { totp: copy.signin.codeRequired });
    }
    if (!totpMatches(member.totpSecret, input.totp)) {
      if (await registerFailure(member)) throw lockoutError();
      throw new ApiError('UNAUTHENTICATED', copy.signin.codeWrong, { fields: { totp: copy.signin.codeWrong } });
    }
  }

  await db.query('delete from login_failures where member_id = $1', [member.id]);
  await db.query('update members set locked_until = null where id = $1', [member.id]);
  const token = await createSession(member.id);
  return { member, token };
}

export async function suspendAccount(username: string, reason: string, actorIsAdmin: boolean): Promise<string> {
  if (!actorIsAdmin) throw errors.forbidden();
  const row = await one<{ id: string; role: string; suspended_at: unknown }>(
    db,
    'select id, role, suspended_at from members where username_ci = $1',
    [username.toLowerCase()],
  );
  if (!row) throw errors.notFound('Account not found');
  if (row.suspended_at !== null || row.role === 'admin') {
    throw errors.conflict('That account cannot be suspended');
  }
  await transaction(async (tx) => {
    await tx.query('update members set suspended_at = now(), suspension_reason = $2 where id = $1', [row.id, reason]);
    await tx.query('update sessions set revoked_at = now() where member_id = $1 and revoked_at is null', [row.id]);
  });
  await emitAccount(String(row.id), 'suspended', null);
  return String(row.id);
}
