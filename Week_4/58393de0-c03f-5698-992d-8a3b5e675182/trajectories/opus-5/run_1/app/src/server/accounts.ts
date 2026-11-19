import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Account } from '../shared/types.js';
import { FIELD_COPY } from '../shared/copy.js';
import { query, queryOne } from './db.js';
import { ApiError, validation } from './errors.js';
import { serverNow } from './clock.js';
import { config } from './config.js';
import { sendMail, verificationMessage } from './mail.js';

export interface AccountRow {
  id: string;
  kind: 'educator' | 'personal' | 'student';
  display_name: string;
  email: string | null;
  email_verified: boolean;
  classroom_id: string | null;
  nickname: string | null;
  password_hash: string | null;
  last_verification_sent_at: Date | null;
}

export const ACCOUNT_COLUMNS =
  'id, kind, display_name, email, email_verified, classroom_id, nickname, password_hash, last_verification_sent_at';

export const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  kind: row.kind,
  displayName: row.display_name,
  email: row.email,
  emailVerified: row.email_verified,
  classroomId: row.classroom_id,
  nickname: row.nickname,
});

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
};

export const passwordMatches = (password: string, stored: string | null): boolean => {
  if (!stored) return false;
  const [, salt, digest] = stored.split('$');
  if (!salt || !digest) return false;
  const candidate = scryptSync(password, salt, 64);
  const known = Buffer.from(digest, 'hex');
  return candidate.length === known.length && timingSafeEqual(candidate, known);
};

const EMAIL_FORM = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateSignup = (
  email: unknown,
  password: unknown,
  displayName: unknown,
  accountType: unknown,
): { email: string; password: string; displayName: string; accountType: 'educator' | 'personal' } => {
  const fields: Record<string, string> = {};
  const cleanEmail = typeof email === 'string' ? email.trim() : '';
  if (!EMAIL_FORM.test(cleanEmail) || cleanEmail.length > 254) fields.email = FIELD_COPY.email;
  const cleanPassword = typeof password === 'string' ? password : '';
  if (cleanPassword.length < 10 || cleanPassword.length > 200) fields.password = FIELD_COPY.password;
  const cleanName = typeof displayName === 'string' ? displayName.trim() : '';
  if (cleanName.length < 1 || cleanName.length > 60) fields.displayName = FIELD_COPY.name;
  if (accountType !== 'educator' && accountType !== 'personal') fields.accountType = FIELD_COPY.name;
  if (Object.keys(fields).length > 0) throw validation(fields);
  return {
    email: cleanEmail,
    password: cleanPassword,
    displayName: cleanName,
    accountType: accountType as 'educator' | 'personal',
  };
};

export const findAccountByEmail = async (email: string): Promise<AccountRow | null> =>
  queryOne<AccountRow>(`select ${ACCOUNT_COLUMNS} from accounts where email_lower = $1`, [email.toLowerCase()]);

export const findAccount = async (id: string): Promise<AccountRow | null> =>
  queryOne<AccountRow>(`select ${ACCOUNT_COLUMNS} from accounts where id = $1`, [id]);

export const createAccount = async (input: {
  email: string;
  password: string;
  displayName: string;
  kind: 'educator' | 'personal';
  verified?: boolean;
}): Promise<AccountRow> => {
  const id = randomUUID();
  const rows = await query<AccountRow>(
    `insert into accounts (id, kind, display_name, email, email_lower, password_hash, email_verified)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${ACCOUNT_COLUMNS}`,
    [id, input.kind, input.displayName, input.email, input.email.toLowerCase(), hashPassword(input.password), input.verified ?? false],
  );
  return rows[0];
};

/** Makes a fresh token, replaces any earlier one, and asks Mailpit to take the message. */
export const sendVerificationEmail = async (account: AccountRow): Promise<boolean> => {
  if (!account.email) return false;
  const token = randomBytes(24).toString('base64url');
  const now = serverNow();
  const expiresAt = new Date(now.getTime() + config.verifyTtlSeconds * 1000);
  await query('update verification_tokens set replaced = true where account_id = $1 and consumed = false', [account.id]);
  await query(
    'insert into verification_tokens (token, account_id, sent_at, expires_at) values ($1, $2, $3, $4)',
    [token, account.id, now, expiresAt],
  );
  const accepted = await sendMail(verificationMessage(account.email, token, expiresAt));
  if (accepted) {
    await query('update accounts set last_verification_sent_at = $2 where id = $1', [account.id, now]);
  }
  return accepted;
};

export const secondsUntilResendAllowed = (account: AccountRow): number => {
  if (!account.last_verification_sent_at) return 0;
  const elapsed = serverNow().getTime() - account.last_verification_sent_at.getTime();
  if (elapsed >= 60_000) return 0;
  return Math.ceil((60_000 - elapsed) / 1000);
};

export const consumeVerificationToken = async (token: string): Promise<AccountRow> => {
  const row = await queryOne<{ account_id: string; expires_at: Date; consumed: boolean; replaced: boolean }>(
    'select account_id, expires_at, consumed, replaced from verification_tokens where token = $1',
    [token],
  );
  if (!row || row.consumed || row.replaced || serverNow().getTime() >= row.expires_at.getTime()) {
    throw new ApiError(410, 'link_expired');
  }
  await query('update verification_tokens set consumed = true where token = $1', [token]);
  await query('update accounts set email_verified = true where id = $1', [row.account_id]);
  const account = await findAccount(row.account_id);
  if (!account) throw new ApiError(410, 'link_expired');
  return account;
};
