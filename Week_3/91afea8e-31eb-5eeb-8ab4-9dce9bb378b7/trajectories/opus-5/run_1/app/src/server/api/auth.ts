/** Accounts and sessions: password then a 6-digit code, with no account probing. */

import { ACCESS_COOKIE, config, PENDING_COOKIE, SESSION_COOKIE } from '../config.js';
import { one, query } from '../db.js';
import {
  EMAIL_PATTERN,
  firstName,
  hashCode,
  hashPassword,
  newCode,
  newId,
  normaliseIdentifier,
  passwordMatches,
  PHONE_PATTERN,
  PINCODE_PATTERN,
} from '../domain/identity.js';
import { ApiError } from '../http/errors.js';
import { empty, json, route, type Ctx, type Reply } from '../http/router.js';
import { Validator } from '../http/validate.js';
import { sendSms, type SmsTemplate } from '../services/provider.js';
import {
  createSession,
  destroyAllSessions,
  refreshAccess,
  destroySession,
} from '../sessions.js';
import { COPY, FIELD } from '../../shared/messages.js';
import type { Account, Role } from '../../shared/types.js';

const PENDING_COOKIE_SECONDS = 600;

type AccountRow = {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string;
  password_hash: string;
  balance_paise: number;
};

function accountView(row: { id: string; name: string; role: Role }): Account {
  return {
    id: row.id,
    name: row.name,
    first_name: firstName(row.name),
    role: row.role,
  };
}

async function sendsInWindow(identifier: string): Promise<{ used: number; retryAfter: number }> {
  const row = await one<{ used: number; retry_after: number | null }>(
    `SELECT count(*)::int AS used,
            CEIL(EXTRACT(EPOCH FROM (min(sent_at) + ($2 || ' seconds')::interval - now())))::int AS retry_after
       FROM code_sends
      WHERE identifier = $1 AND sent_at > now() - ($2 || ' seconds')::interval`,
    [identifier, String(config.codeWindowSeconds)],
  );
  return {
    used: row === null ? 0 : row.used,
    retryAfter: row === null || row.retry_after === null ? config.codeWindowSeconds : Math.max(1, row.retry_after),
  };
}

async function guardSendWindow(identifier: string): Promise<void> {
  const { used, retryAfter } = await sendsInWindow(identifier);
  if (used >= 3) {
    throw new ApiError(429, 'too_many_codes', {}, { retry_after: retryAfter });
  }
}

async function countSend(identifier: string): Promise<void> {
  await query('INSERT INTO code_sends (identifier) VALUES ($1)', [identifier]);
}

async function secondsSinceLastSend(identifier: string): Promise<number | null> {
  const row = await one<{ gap: number | null }>(
    `SELECT EXTRACT(EPOCH FROM (now() - max(sent_at)))::int AS gap FROM code_sends WHERE identifier = $1`,
    [identifier],
  );
  return row === null ? null : row.gap;
}

async function findAccountByIdentifier(identifier: string): Promise<AccountRow | null> {
  return one<AccountRow>(
    `SELECT id, role, name, email, phone, password_hash, balance_paise
       FROM accounts WHERE email = lower($1) OR phone = $1`,
    [identifier],
  );
}

async function issueCode(input: {
  purpose: 'signin' | 'signup' | 'reset';
  identifier: string;
  accountId: string | null;
  signup: Record<string, unknown> | null;
  code: string | null;
}): Promise<string> {
  await query(
    `UPDATE auth_codes SET consumed = true WHERE identifier = $1 AND purpose = $2 AND consumed = false`,
    [input.identifier, input.purpose],
  );
  const id = newId('AC-');
  await query(
    `INSERT INTO auth_codes (id, purpose, identifier, account_id, signup, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, now() + ($7 || ' seconds')::interval)`,
    [
      id,
      input.purpose,
      input.identifier,
      input.accountId,
      input.signup === null ? null : JSON.stringify(input.signup),
      input.code === null ? null : hashCode(input.code),
      String(config.otpTtlSeconds),
    ],
  );
  return id;
}

type CodeRow = {
  id: string;
  purpose: string;
  identifier: string;
  account_id: string | null;
  signup: Record<string, unknown> | null;
  code_hash: string | null;
  tries: number;
  expired: boolean;
};

async function takeCode(id: string, code: string): Promise<CodeRow> {
  const row = await one<CodeRow>(
    `SELECT id, purpose, identifier, account_id, signup, code_hash, tries, (expires_at <= now()) AS expired
       FROM auth_codes WHERE id = $1 AND consumed = false`,
    [id],
  );
  if (row === null) throw new ApiError(401, 'invalid_code');
  if (row.tries >= 5 || row.expired || row.code_hash === null) {
    await query('UPDATE auth_codes SET tries = tries + 1 WHERE id = $1', [id]);
    throw new ApiError(401, 'invalid_code');
  }
  await query('UPDATE auth_codes SET tries = tries + 1 WHERE id = $1', [id]);
  if (row.code_hash !== hashCode(code)) throw new ApiError(401, 'invalid_code');
  await query('UPDATE auth_codes SET consumed = true WHERE id = $1', [id]);
  return row;
}

async function startSession(ctx: Ctx, accountId: string): Promise<void> {
  const { sessionId, accessId } = await createSession(accountId);
  ctx.clearCookie(PENDING_COOKIE);
  ctx.setCookie(SESSION_COOKIE, sessionId, config.sessionTtlSeconds);
  ctx.setCookie(ACCESS_COOKIE, accessId, config.accessTtlSeconds);
}

function readCode(ctx: Ctx): string {
  const value = ctx.body.code;
  if (typeof value !== 'string' || !/^[0-9]{6}$/.test(value)) {
    throw new ApiError(401, 'invalid_code');
  }
  return value;
}

export function registerAuthRoutes(): void {
  route('POST', '/api/auth/signup', 'public', async (ctx) => {
    const validator = new Validator(ctx.body, ['name', 'email', 'phone', 'password']);
    const name = validator.text('name', { label: 'Name', min: 1, max: 60 });
    const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(email)) validator.fail('email', FIELD.tooShort('Email', 3));
    const phone = typeof ctx.body.phone === 'string' ? ctx.body.phone.replace(/[\s-]/g, '') : '';
    if (!PHONE_PATTERN.test(phone)) validator.fail('phone', FIELD.badPhone);
    const password = validator.text('password', { label: 'Password', min: 10, max: 128 });
    validator.done();

    await guardSendWindow(phone);
    const existing = await one<{ id: string }>(
      `SELECT id FROM accounts WHERE email = $1 OR phone = $2`,
      [email, phone],
    );
    const code = existing === null ? newCode() : null;
    const template: SmsTemplate = existing === null ? 'signup_code' : 'signup_existing';
    const sent = await sendSms({ to: phone, template, ...(code === null ? {} : { code }) });
    if (!sent) throw new ApiError(503, 'sms_unavailable');
    await countSend(phone);
    const pendingId = await issueCode({
      purpose: 'signup',
      identifier: phone,
      accountId: null,
      signup: existing === null ? { name, email, phone, password_hash: hashPassword(password) } : null,
      code,
    });
    ctx.setCookie(PENDING_COOKIE, pendingId, PENDING_COOKIE_SECONDS);
    return json({ status: 'code_sent', message: COPY.codeMaybeSent }, 202);
  });

  route('POST', '/api/auth/signup/verify', 'pending', async (ctx) => {
    const code = readCode(ctx);
    const pending = ctx.pending;
    if (pending === null || pending.purpose !== 'signup') throw new ApiError(401, 'invalid_code');
    const row = await takeCode(pending.id, code);
    const signup = row.signup as {
      name: string;
      email: string;
      phone: string;
      password_hash: string;
    } | null;
    if (signup === null) throw new ApiError(401, 'invalid_code');
    const accountId = newId('U-');
    await query(
      `INSERT INTO accounts (id, role, name, email, phone, password_hash, balance_paise)
       VALUES ($1, 'shopper', $2, $3, $4, $5, 0)`,
      [accountId, signup.name, signup.email, signup.phone, signup.password_hash],
    );
    await query('INSERT INTO cart_state (account_id) VALUES ($1)', [accountId]);
    await startSession(ctx, accountId);
    return json(
      { account: accountView({ id: accountId, name: signup.name, role: 'shopper' }) },
      201,
    );
  });

  route('POST', '/api/auth/signin', 'public', async (ctx) => {
    const raw = typeof ctx.body.identifier === 'string' ? ctx.body.identifier : '';
    const validator = new Validator(ctx.body, ['identifier', 'password']);
    const identifier = normaliseIdentifier(raw);
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    validator.done();
    if (identifier === null) throw new ApiError(401, 'invalid_credentials');

    await guardSendWindow(identifier.value);
    const account = await findAccountByIdentifier(identifier.value);
    if (account === null || !passwordMatches(password, account.password_hash)) {
      throw new ApiError(401, 'invalid_credentials');
    }
    const code = newCode();
    const sent = await sendSms({ to: account.phone, template: 'signin_code', code });
    if (!sent) throw new ApiError(503, 'sms_unavailable');
    await countSend(identifier.value);
    const pendingId = await issueCode({
      purpose: 'signin',
      identifier: identifier.value,
      accountId: account.id,
      signup: null,
      code,
    });
    ctx.setCookie(PENDING_COOKIE, pendingId, PENDING_COOKIE_SECONDS);
    return json(
      {
        status: 'code_sent',
        message: COPY.codeSent,
        resend_in: config.codeResendSeconds,
      },
      202,
    );
  });

  route('POST', '/api/auth/signin/verify', 'pending', async (ctx) => {
    const code = readCode(ctx);
    const pending = ctx.pending;
    if (pending === null || pending.purpose !== 'signin' || pending.accountId === null) {
      throw new ApiError(401, 'invalid_code');
    }
    await takeCode(pending.id, code);
    const account = await one<{ id: string; name: string; role: Role }>(
      `SELECT id, name, role FROM accounts WHERE id = $1`,
      [pending.accountId],
    );
    if (account === null) throw new ApiError(401, 'invalid_code');
    await startSession(ctx, account.id);
    return json({ account: accountView(account) });
  });

  route('POST', '/api/auth/code/resend', 'pending', async (ctx) => {
    const pending = ctx.pending;
    if (pending === null) throw new ApiError(401, 'signed_out');
    const gap = await secondsSinceLastSend(pending.identifier);
    if (gap !== null && gap < config.codeResendSeconds) {
      throw new ApiError(
        429,
        'resend_too_soon',
        {},
        { retry_after: config.codeResendSeconds - gap },
      );
    }
    await guardSendWindow(pending.identifier);
    const account =
      pending.accountId === null ? null : await one<{ phone: string }>(
        `SELECT phone FROM accounts WHERE id = $1`,
        [pending.accountId],
      );
    const existing =
      pending.purpose === 'signup'
        ? await one<{ id: string }>(`SELECT id FROM accounts WHERE phone = $1`, [pending.identifier])
        : null;
    const to = account?.phone ?? pending.identifier;
    const template: SmsTemplate =
      pending.purpose === 'signin' ? 'signin_code' : existing === null ? 'signup_code' : 'signup_existing';
    const code = template === 'signup_existing' ? null : newCode();
    const sent = await sendSms({ to, template, ...(code === null ? {} : { code }) });
    if (!sent) throw new ApiError(503, 'sms_unavailable');
    await countSend(pending.identifier);
    const previous = await one<{ signup: Record<string, unknown> | null }>(
      `SELECT signup FROM auth_codes WHERE id = $1`,
      [pending.id],
    );
    const pendingId = await issueCode({
      purpose: pending.purpose,
      identifier: pending.identifier,
      accountId: pending.accountId,
      signup: previous?.signup ?? null,
      code,
    });
    ctx.setCookie(PENDING_COOKIE, pendingId, PENDING_COOKIE_SECONDS);
    return json({ status: 'code_sent', resend_in: config.codeResendSeconds }, 202);
  });

  route('POST', '/api/auth/password/forgot', 'public', async (ctx) => {
    const validator = new Validator(ctx.body, ['identifier']);
    const raw = typeof ctx.body.identifier === 'string' ? ctx.body.identifier : '';
    const identifier = normaliseIdentifier(raw);
    if (identifier === null) validator.fail('identifier', FIELD.tooShort('Name', 3));
    validator.done();
    if (identifier === null) throw new ApiError(422, 'validation_failed');

    await guardSendWindow(identifier.value);
    const account = await findAccountByIdentifier(identifier.value);
    if (account !== null) {
      const code = newCode();
      await sendSms({ to: account.phone, template: 'reset_code', code });
      await issueCode({
        purpose: 'reset',
        identifier: identifier.value,
        accountId: account.id,
        signup: null,
        code,
      });
    }
    await countSend(identifier.value);
    return json({ status: 'code_sent', message: COPY.codeMaybeSent }, 202);
  });

  route('POST', '/api/auth/password/reset', 'public', async (ctx) => {
    const validator = new Validator(ctx.body, ['identifier', 'code', 'new_password']);
    const raw = typeof ctx.body.identifier === 'string' ? ctx.body.identifier : '';
    const identifier = normaliseIdentifier(raw);
    const newPassword = validator.text('new_password', { label: 'Password', min: 10, max: 128 });
    validator.done();
    const code = readCode(ctx);
    if (identifier === null) throw new ApiError(401, 'invalid_code');
    const pending = await one<{ id: string }>(
      `SELECT id FROM auth_codes
        WHERE identifier = $1 AND purpose = 'reset' AND consumed = false
        ORDER BY issued_at DESC LIMIT 1`,
      [identifier.value],
    );
    if (pending === null) throw new ApiError(401, 'invalid_code');
    const row = await takeCode(pending.id, code);
    if (row.account_id === null) throw new ApiError(401, 'invalid_code');
    await query('UPDATE accounts SET password_hash = $2 WHERE id = $1', [
      row.account_id,
      hashPassword(newPassword),
    ]);
    await destroyAllSessions(row.account_id);
    return json({ status: 'password_reset' });
  });

  route('POST', '/api/auth/refresh', 'public', async (ctx) => {
    const sessionId = ctx.cookies[SESSION_COOKIE];
    if (sessionId === undefined) throw new ApiError(401, 'signed_out');
    const accessId = await refreshAccess(sessionId);
    if (accessId === null) throw new ApiError(401, 'signed_out');
    ctx.setCookie(ACCESS_COOKIE, accessId, config.accessTtlSeconds);
    return json({ status: 'refreshed' });
  });

  route('POST', '/api/auth/signout', 'public', async (ctx): Promise<Reply> => {
    const sessionId = ctx.cookies[SESSION_COOKIE];
    if (sessionId !== undefined) await destroySession(sessionId);
    ctx.clearCookie(SESSION_COOKIE);
    ctx.clearCookie(ACCESS_COOKIE);
    ctx.clearCookie(PENDING_COOKIE);
    return empty(204);
  });

  route('GET', '/api/me', 'signed_in', async (ctx) => {
    const account = await one<{ id: string; name: string; role: Role; balance_paise: number }>(
      `SELECT id, name, role, balance_paise FROM accounts WHERE id = $1`,
      [ctx.account?.accountId],
    );
    if (account === null) throw new ApiError(401, 'signed_out');
    return json({ account: accountView(account), balance_paise: account.balance_paise });
  });

  route('POST', '/api/account/password', 'signed_in', async (ctx) => {
    const validator = new Validator(ctx.body, ['current_password', 'new_password']);
    const current = typeof ctx.body.current_password === 'string' ? ctx.body.current_password : '';
    const next = validator.text('new_password', { label: 'Password', min: 10, max: 128 });
    const accountId = ctx.account?.accountId ?? '';
    const account = await one<{ password_hash: string }>(
      `SELECT password_hash FROM accounts WHERE id = $1`,
      [accountId],
    );
    if (account === null || !passwordMatches(current, account.password_hash)) {
      validator.fail('current_password', FIELD.wrongCurrentPassword);
    }
    validator.done();
    await query('UPDATE accounts SET password_hash = $2 WHERE id = $1', [
      accountId,
      hashPassword(next),
    ]);
    await destroyAllSessions(accountId);
    await startSession(ctx, accountId);
    return json({ status: 'password_changed' });
  });

  route('GET', '/api/account/addresses', 'signed_in', async (ctx) => {
    const addresses = await query(
      `SELECT id, label, name, line1, line2, city, pincode, phone FROM addresses
        WHERE account_id = $1 ORDER BY created_seq`,
      [ctx.account?.accountId],
    );
    return json({ addresses });
  });

  route('POST', '/api/account/addresses', 'signed_in', async (ctx) => {
    const validator = new Validator(ctx.body, [
      'label',
      'name',
      'line1',
      'line2',
      'city',
      'pincode',
      'phone',
    ]);
    const label = validator.text('label', { label: 'Name', min: 1, max: 40 });
    const name = validator.text('name', { label: 'Name', min: 1, max: 60 });
    const line1 = validator.text('line1', { label: 'Name', min: 1, max: 120 });
    const line2 = validator.text('line2', { label: 'Name', min: 0, max: 120 });
    const city = validator.text('city', { label: 'Name', min: 1, max: 60 });
    const pincode = typeof ctx.body.pincode === 'string' ? ctx.body.pincode.trim() : '';
    if (!PINCODE_PATTERN.test(pincode)) validator.fail('pincode', FIELD.badPincode);
    const phoneRaw = typeof ctx.body.phone === 'string' ? ctx.body.phone.replace(/[\s-]/g, '') : '';
    const phone = phoneRaw.startsWith('+91') ? phoneRaw : `+91${phoneRaw}`;
    if (!PHONE_PATTERN.test(phone)) validator.fail('phone', FIELD.badPhone);
    validator.done();
    const id = newId('ADDR-');
    await query(
      `INSERT INTO addresses (id, account_id, label, name, line1, line2, city, pincode, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, ctx.account?.accountId, label, name, line1, line2, city, pincode, phone],
    );
    const address = await one(
      `SELECT id, label, name, line1, line2, city, pincode, phone FROM addresses WHERE id = $1`,
      [id],
    );
    return json(address, 201);
  });

  route('DELETE', '/api/account/addresses/:id', 'signed_in', async (ctx) => {
    const rows = await query<{ id: string }>(
      `DELETE FROM addresses WHERE id = $1 AND account_id = $2 RETURNING id`,
      [ctx.params.id, ctx.account?.accountId],
    );
    if (rows.length === 0) throw new ApiError(404, 'not_found');
    return empty(204);
  });

  route('GET', '/api/account/cards', 'signed_in', async (ctx) => {
    const cards = await query(
      `SELECT card_id, network, last4, expiry_month, expiry_year, name FROM cards
        WHERE account_id = $1 ORDER BY created_seq`,
      [ctx.account?.accountId],
    );
    return json({ cards });
  });

  route('DELETE', '/api/account/cards/:id', 'signed_in', async (ctx) => {
    const rows = await query<{ card_id: string }>(
      `DELETE FROM cards WHERE card_id = $1 AND account_id = $2 RETURNING card_id`,
      [ctx.params.id, ctx.account?.accountId],
    );
    if (rows.length === 0) throw new ApiError(404, 'not_found');
    return empty(204);
  });

  route(
    'POST',
    '/api/balance/redeem',
    'shopper',
    async (ctx) => {
      const validator = new Validator(ctx.body, ['code']);
      const code = typeof ctx.body.code === 'string' ? ctx.body.code.trim() : '';
      if (code === '') validator.fail('code', FIELD.badGiftCard);
      validator.done();
      const accountId = ctx.account?.accountId ?? '';
      const claimed = await query<{ amount_paise: number }>(
        `UPDATE gift_cards SET redeemed_by = $2, redeemed_at = now()
          WHERE upper(code) = upper($1) AND redeemed_by IS NULL
          RETURNING amount_paise`,
        [code, accountId],
      );
      if (claimed.length === 0) throw new ApiError(422, 'validation_failed', {}, { errors: { code: FIELD.badGiftCard } });
      const updated = await one<{ balance_paise: number }>(
        `UPDATE accounts SET balance_paise = balance_paise + $2 WHERE id = $1 RETURNING balance_paise`,
        [accountId, claimed[0].amount_paise],
      );
      return json({ balance_paise: updated?.balance_paise ?? 0 });
    },
    { rate: 'giftcard' },
  );
}
