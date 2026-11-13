import { query, transaction, type DBClient } from './db.js';
import { randomUUID } from 'node:crypto';
import config from './config.js';
import { sendMail, MailUnavailable, type Mail } from './mail.js';
import type { Locale } from '../shared/domain.js';

export type AccountRow = {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
  email_verified: boolean;
  verification_email: 'sent' | 'not_sent';
  storage_notice: 'upload_unavailable' | 'delete_unavailable' | null;
};

export function accountJson(a: AccountRow): Record<string, unknown> {
  return {
    id: a.id,
    email: a.email,
    display_name: a.display_name,
    locale: a.locale,
    email_verified: a.email_verified,
    verification_email: a.verification_email,
    storage_notice: a.storage_notice,
  };
}

export async function createSession(accountId: string): Promise<string> {
  const token = (await import('./auth.js')).randomToken();
  await query('insert into sessions (token, account_id, expires_at) values ($1, $2, now() + interval \'30 days\')', [token, accountId]);
  return token;
}

export async function endSessions(accountId: string): Promise<void> {
  await query('delete from sessions where account_id = $1', [accountId]);
}

async function createEmailToken(client: DBClient, accountId: string, kind: 'verify' | 'reset'): Promise<string> {
  const { randomToken } = await import('./auth.js');
  const token = randomToken();
  // A newer email cancels every earlier link of the same kind.
  await client.query("update email_tokens set cancelled_at = now() where account_id = $1 and kind = $2 and cancelled_at is null and used_at is null", [accountId, kind]);
  await client.query('insert into email_tokens (token, account_id, kind, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))', [token, accountId, kind, config.mailLinkTtlSeconds]);
  return token;
}

export type TokenVerdict = 'ok' | 'unknown' | 'used' | 'replaced' | 'expired';

export async function judgeToken(token: string, kind: 'verify' | 'reset'): Promise<TokenVerdict> {
  const res = await query<{ token: string; used_at: Date | null; cancelled_at: Date | null; expires_at: Date }>(
    'select token, used_at, cancelled_at, expires_at from email_tokens where token = $1 and kind = $2',
    [token, kind],
  );
  const row = res.rows[0];
  if (!row) return 'unknown';
  if (row.used_at) return 'used';
  if (row.cancelled_at) return 'replaced';
  if (row.expires_at.getTime() <= Date.now()) return 'expired';
  return 'ok';
}

export async function useToken(token: string, kind: 'verify' | 'reset'): Promise<{ account_id: string } | null> {
  const res = await query<{ account_id: string }>(
    "update email_tokens set used_at = now() where token = $1 and kind = $2 and used_at is null returning account_id",
    [token, kind],
  );
  return res.rows[0] ?? null;
}

/** Sends one email in the account's locale; the only place mail is delivered (DP-03, DP-62). */
export async function sendAccountEmail(account: AccountRow, kind: 'verify' | 'reset'): Promise<'sent' | 'not_sent'> {
  const token = await transaction((client) => createEmailToken(client, account.id, kind));
  const path = kind === 'verify' ? 'verify' : 'reset-password';
  const link = `${config.publicUrl}/${path}?token=${encodeURIComponent(token)}`;
  const { dicts } = await import('../shared/i18n.js');
  const entry = dicts[account.locale].emails[kind === 'verify' ? 'verification' : 'reset'];
  if (!entry) throw new Error('missing email template');
  const built = entry.body({ link });
  const mail: Mail = {
    to: account.email,
    subject: entry.subject,
    html: built.html,
    text: built.text,
    lang: account.locale,
  };
  try {
    await sendMail(mail);
    return 'sent';
  } catch (err) {
    if (err instanceof MailUnavailable) return 'not_sent';
    if (err instanceof Error && err.message.startsWith('smtp refused')) return 'sent';
    return 'not_sent';
  }
}
