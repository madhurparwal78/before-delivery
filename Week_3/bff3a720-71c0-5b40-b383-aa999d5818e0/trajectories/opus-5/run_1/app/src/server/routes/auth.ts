import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { now } from '../clock.js';
import { db, withTransaction, type Queryable } from '../db.js';
import { errors } from '../errors.js';
import { addSeconds } from '../domain/time.js';
import { checkLimit, recordAttempt } from '../limits.js';
import { keys } from '../valkey.js';
import { flushRows, mailCopy, queueEmail } from '../outbox.js';
import { loadMemberByEmail, serialiseMember } from '../model.js';
import type { Ctx, Reply, Router } from '../http.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionCookie(token: string): string {
  return `ls_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export async function createSession(
  memberId: string,
  tx: Queryable = db,
): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await tx.query('insert into sessions (token, member_id, created_at) values ($1, $2, $3)', [
    token,
    memberId,
    now(),
  ]);
  return token;
}

async function requestCode(ctx: Ctx): Promise<Reply> {
  const body = ctx.json();
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_PATTERN.test(email) || email.length > 200) {
    throw errors.validationFailed({ email: 'Write an email address like name@example.com.' });
  }
  const at = now();
  const decision = await checkLimit(
    keys.rateCodes(email),
    config.limits.signinCodeRatePerHour,
    3_600_000,
    at,
  );
  if (!decision.allowed) throw errors.rateLimitedCodes(decision.retryAfterSeconds);

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const emailId = await withTransaction(async (tx) => {
    await tx.query('update sign_in_codes set superseded = true where email = $1', [email]);
    await tx.query(
      `insert into sign_in_codes (id, email, code, issued_at, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [randomUUID(), email, code, at, addSeconds(at, config.limits.emailCodeTtlSeconds)],
    );
    const copy = mailCopy.signInCode(code);
    return queueEmail(tx, {
      kind: 'sign_in_code',
      to: email,
      subject: copy.subject,
      body: copy.body,
    });
  });
  await recordAttempt(keys.rateCodes(email), at);
  await flushRows([emailId]);
  return { status: 202, body: { sent: true } };
}

async function verifyCode(ctx: Ctx): Promise<Reply> {
  const body = ctx.json();
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const fields: Record<string, string> = {};
  if (!EMAIL_PATTERN.test(email)) {
    fields.email = 'Write an email address like name@example.com.';
  }
  if (!/^\d{6}$/.test(code)) fields.code = 'Write the six digits from the email.';
  if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

  const at = now();
  const { rows } = await db.query<{ id: string; code: string; expires_at: Date }>(
    `select id, code, expires_at from sign_in_codes
      where email = $1 and consumed_at is null and superseded = false
      order by issued_at desc limit 1`,
    [email],
  );
  const stored = rows[0];
  if (!stored || stored.code !== code) throw errors.codeInvalid();
  if (stored.expires_at.getTime() <= at.getTime()) throw errors.codeExpired();

  const existing = await loadMemberByEmail(db, email);
  const displayName =
    typeof body.display_name === 'string' ? body.display_name.trim() : '';
  if (!existing && (displayName.length < 1 || displayName.length > 60)) {
    throw errors.validationFailed({ display_name: 'Write the name other members will see.' });
  }

  const member = await withTransaction(async (tx) => {
    await tx.query('update sign_in_codes set consumed_at = $2 where id = $1', [stored.id, at]);
    if (existing) return existing;
    const id = randomUUID();
    await tx.query(
      `insert into members (id, display_name, email, roles, id_state, created_at)
       values ($1, $2, $3, $4, 'none', $5)`,
      [id, displayName, email, ['driver', 'passenger'], at],
    );
    return {
      id,
      display_name: displayName,
      email,
      roles: ['driver', 'passenger'],
      id_state: 'none',
      photo_file_id: null,
    };
  });

  const token = await createSession(member.id);
  return {
    status: 200,
    body: await serialiseMember(db, member, { self: true }),
    headers: { 'Set-Cookie': sessionCookie(token) },
  };
}

async function signOut(ctx: Ctx): Promise<Reply> {
  const token = ctx.cookie('ls_session');
  if (token) await db.query('delete from sessions where token = $1', [token]);
  return {
    status: 204,
    noContent: true,
    headers: { 'Set-Cookie': 'ls_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' },
  };
}

export function registerAuthRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/auth/code',
    kind: 'json',
    auth: 'none',
    handler: requestCode,
  });
  router.add({
    method: 'POST',
    pattern: '/api/auth/verify',
    kind: 'json',
    auth: 'none',
    handler: verifyCode,
  });
  router.add({
    method: 'POST',
    pattern: '/api/auth/sign-out',
    kind: 'plain',
    auth: 'member',
    handler: signOut,
  });
}
