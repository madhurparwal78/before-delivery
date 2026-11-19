import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { isDbReady, isUniqueViolation, pool, query, transaction } from '../db.js';
import { errors } from '../errors.js';
import {
  accountByDisplayName,
  accountByEmail,
  accountById,
  createAuthSession,
  deleteAllAuthSessions,
  deleteAuthSession,
  hashPassword,
  insertDefaultHero,
  rowToAccount,
  verifyPassword,
  type AccountRow,
} from '../accounts.js';
import {
  localeCookie,
  readJsonBody,
  requireAccount,
  sessionCookie,
  clearedSessionCookie,
  SESSION_COOKIE,
  type Ctx,
  type Reply,
} from '../http.js';
import { buildMail } from '../mail/templates.js';
import { probeMail, sendMail } from '../mail/smtp.js';
import { isWellFormedEmail, nameWithinLimit, passwordWithinLimit } from '../../shared/text.js';
import { isLocale, type Locale } from '../../shared/i18n/index.js';
import type { LocalisedText } from '../errors.js';

type MailKind = 'verification' | 'reset';

function body(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function validateCredentials(input: Record<string, unknown>, withName: boolean): {
  email: string;
  password: string;
  displayName: string;
  locale: Locale;
} {
  const fields: Record<string, LocalisedText> = {};
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const displayName = typeof input.display_name === 'string' ? input.display_name.trim() : '';
  const locale = isLocale(input.locale) ? input.locale : null;

  if (!isWellFormedEmail(email)) fields.email = { key: 'fb.emailMalformed' };
  if (!passwordWithinLimit(password)) fields.password = { key: 'fb.passwordLimit' };
  if (withName) {
    if (!nameWithinLimit(displayName)) fields.display_name = { key: 'fb.displayNameLimit' };
    if (locale === null) fields.locale = { key: 'fb.generic' };
  }
  if (Object.keys(fields).length > 0) throw errors.invalidFields(fields);
  return { email, password, displayName, locale: locale ?? 'en' };
}

async function issueToken(accountId: string, kind: MailKind): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await pool.query(
    `UPDATE email_tokens SET replaced = true
     WHERE account_id = $1 AND kind = $2 AND used_at IS NULL AND replaced = false`,
    [accountId, kind],
  );
  await pool.query(
    `INSERT INTO email_tokens (token, account_id, kind, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [token, accountId, kind, config.mailLinkTtlSeconds],
  );
  return token;
}

interface TokenRow {
  token: string;
  account_id: string;
  kind: MailKind;
  expires_at: Date;
  used_at: Date | null;
  replaced: boolean;
}

/** Email links are judged used, then replaced, then expired. */
async function judgeToken(raw: unknown, kind: MailKind): Promise<TokenRow> {
  if (typeof raw !== 'string' || raw === '') throw errors.notFound();
  const rows = await query<TokenRow>(
    'SELECT * FROM email_tokens WHERE token = $1 AND kind = $2',
    [raw, kind],
  );
  const row = rows[0];
  if (row === undefined) throw errors.notFound();
  if (row.used_at !== null) throw errors.gone('link_used', { key: 'fb.linkUsed' });
  if (row.replaced) throw errors.gone('link_replaced', { key: 'fb.linkReplaced' });
  if (row.expires_at.getTime() <= Date.now()) {
    throw errors.gone('link_expired', { key: 'fb.linkExpired' });
  }
  return row;
}

async function deliverVerification(account: AccountRow): Promise<boolean> {
  const token = await issueToken(account.id, 'verification');
  try {
    await sendMail(buildMail('verification', account.locale, account.email, token));
  } catch {
    return false;
  }
  await pool.query(`UPDATE accounts SET verification_email = 'sent' WHERE id = $1`, [account.id]);
  return true;
}

export async function health(): Promise<Reply> {
  if (!isDbReady()) return { status: 503, body: { status: 'starting' } };
  return { status: 200, body: { status: 'ok' } };
}

export async function putLocale(ctx: Ctx): Promise<Reply> {
  const input = body(await readJsonBody(ctx.req));
  if (!isLocale(input.locale)) throw errors.invalidField('locale', { key: 'fb.generic' });
  const locale = input.locale;
  if (ctx.account !== null) {
    await pool.query('UPDATE accounts SET locale = $2 WHERE id = $1', [ctx.account.id, locale]);
  }
  return { status: 204, cookies: [localeCookie(locale)] };
}

export async function signup(ctx: Ctx): Promise<Reply> {
  const input = body(await readJsonBody(ctx.req));
  const { email, password, displayName, locale } = validateCredentials(input, true);

  if ((await accountByEmail(email)) !== null) {
    throw errors.conflict('email_taken', { key: 'fb.emailTaken' });
  }
  if ((await accountByDisplayName(displayName)) !== null) {
    throw errors.conflict('display_name_taken', { key: 'fb.displayNameTaken' });
  }

  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO accounts
         (id, email, email_lower, password_hash, display_name, display_name_lower, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        email,
        email.toLowerCase(),
        hashPassword(password),
        displayName,
        displayName.toLowerCase(),
        locale,
      ],
    );
    await insertDefaultHero(client, id, displayName);
  }).catch((error: unknown) => {
    // A racer that passed the checks above with the same email or name loses here.
    if (isUniqueViolation(error, 'accounts_email_lower_key')) {
      throw errors.conflict('email_taken', { key: 'fb.emailTaken' });
    }
    if (isUniqueViolation(error, 'accounts_display_name_lower_key')) {
      throw errors.conflict('display_name_taken', { key: 'fb.displayNameTaken' });
    }
    throw error;
  });

  const created = await accountById(id);
  if (created === null) throw errors.internal();
  await deliverVerification(created);
  const fresh = await accountById(id);
  if (fresh === null) throw errors.internal();
  const token = await createAuthSession(id);
  const account = rowToAccount(fresh);
  return {
    status: 201,
    body: { account, verification_email: account.verification_email },
    cookies: [sessionCookie(token), localeCookie(account.locale)],
  };
}

export async function signin(ctx: Ctx): Promise<Reply> {
  const input = body(await readJsonBody(ctx.req));
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const row = await accountByEmail(email);
  if (row === null || !verifyPassword(password, row.password_hash)) {
    throw errors.invalidCredentials();
  }
  const token = await createAuthSession(row.id);
  return {
    status: 200,
    body: { account: rowToAccount(row) },
    cookies: [sessionCookie(token), localeCookie(row.locale)],
  };
}

export async function signout(ctx: Ctx): Promise<Reply> {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token !== undefined) await deleteAuthSession(token);
  return { status: 204, cookies: [clearedSessionCookie()] };
}

export async function verifyEmail(ctx: Ctx): Promise<Reply> {
  const input = body(await readJsonBody(ctx.req));
  const token = await judgeToken(input.token, 'verification');
  await pool.query('UPDATE email_tokens SET used_at = now() WHERE token = $1', [token.token]);
  await pool.query(
    `UPDATE accounts SET email_verified = true, verification_email = 'sent' WHERE id = $1`,
    [token.account_id],
  );
  const account = await accountById(token.account_id);
  if (account === null) throw errors.internal();
  return { status: 200, body: { account: rowToAccount(account) } };
}

export async function resendVerification(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  if (account.email_verified) {
    throw errors.conflict('already_verified', { key: 'fb.generic' });
  }
  const sent = await deliverVerification(account);
  if (!sent) throw errors.mailUnavailable('verification');
  return { status: 202, body: { verification_email: 'sent' } };
}

export async function requestPasswordReset(ctx: Ctx): Promise<Reply> {
  const input = body(await readJsonBody(ctx.req));
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (!isWellFormedEmail(email)) throw errors.invalidField('email', { key: 'fb.emailMalformed' });
  const account = await accountByEmail(email);
  try {
    if (account === null) {
      await probeMail();
    } else {
      const token = await issueToken(account.id, 'reset');
      await sendMail(buildMail('reset', account.locale, account.email, token));
    }
  } catch {
    throw errors.mailUnavailable('reset');
  }
  return { status: 202, body: {} };
}

export async function confirmPasswordReset(ctx: Ctx): Promise<Reply> {
  const input = body(await readJsonBody(ctx.req));
  const password = typeof input.password === 'string' ? input.password : '';
  const token = await judgeToken(input.token, 'reset');
  if (!passwordWithinLimit(password)) {
    throw errors.invalidField('password', { key: 'fb.passwordLimit' });
  }
  await pool.query('UPDATE email_tokens SET used_at = now() WHERE token = $1', [token.token]);
  await pool.query('UPDATE accounts SET password_hash = $2 WHERE id = $1', [
    token.account_id,
    hashPassword(password),
  ]);
  await deleteAllAuthSessions(token.account_id);
  return { status: 200, body: {}, cookies: [clearedSessionCookie()] };
}

export async function me(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  return {
    status: 200,
    body: {
      account: rowToAccount(account),
      equipped_character_id: account.equipped_character_id,
    },
  };
}

export async function patchMe(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const input = body(await readJsonBody(ctx.req));
  if (input.display_name !== undefined) {
    const displayName = typeof input.display_name === 'string' ? input.display_name.trim() : '';
    if (!nameWithinLimit(displayName)) {
      throw errors.invalidField('display_name', { key: 'fb.displayNameLimit' });
    }
    const taken = await accountByDisplayName(displayName);
    if (taken !== null && taken.id !== account.id) {
      throw errors.conflict('display_name_taken', { key: 'fb.displayNameTaken' });
    }
    await pool.query('UPDATE accounts SET display_name = $2, display_name_lower = $3 WHERE id = $1', [
      account.id,
      displayName,
      displayName.toLowerCase(),
    ]);
  }
  const fresh = await accountById(account.id);
  if (fresh === null) throw errors.internal();
  return { status: 200, body: { account: rowToAccount(fresh) } };
}
