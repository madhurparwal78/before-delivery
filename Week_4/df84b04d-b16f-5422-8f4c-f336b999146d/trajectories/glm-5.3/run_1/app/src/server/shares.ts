import type { Pool } from 'pg';
import type { Config } from './config.js';
import { ApiError, newId, newToken } from './store.js';
import type { Account } from '../domain/types.js';
import { rowToShare } from './outline-service.js';
import type { ShareRow, ShareStatus } from '../domain/types.js';
import { SmtpClient, type MailMessage } from './mail.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(value: string): boolean {
  return EMAIL_RE.test(value) && value.length <= 254;
}

export async function listShares(pool: Pool, bulletId: string): Promise<ShareRow[]> {
  const rows = await pool.query(
    `select * from shares where bullet_id = $1 and status <> 'revoked' order by created_at asc`,
    [bulletId],
  );
  return rows.rows.map(rowToShare);
}

export async function createShare(
  pool: Pool,
  config: Config,
  smtp: SmtpClient,
  owner: Account,
  bulletId: string,
  emailRaw: string,
  bulletText: string,
): Promise<ShareRow> {
  const email = emailRaw.trim().toLowerCase();
  if (!validEmail(email)) {
    throw new ApiError(422, { errors: { email: 'Enter a valid email address.' } });
  }
  if (email === owner.email) {
    throw new ApiError(422, { errors: { email: "You can't invite yourself." } });
  }
  const existing = await pool.query(
    `select * from shares where bullet_id = $1 and email = $2 and status in ('pending_send','sent','not_sent','accepted')`,
    [bulletId, email],
  );
  if (existing.rows.length > 0) {
    throw new ApiError(409, {
      error: 'already_invited',
      message: 'This address already has an open invitation to this bullet.',
    });
  }
  const id = newId();
  const token = newToken();
  await pool.query(
    `insert into shares (id, bullet_id, owner_id, email, token, status, created_at)
     values ($1,$2,$3,$4,$5,'pending_send',$6)`,
    [id, bulletId, owner.id, email, token, Date.now()],
  );
  const message: MailMessage = {
    from: config.mailFrom,
    to: email,
    subject: `${owner.name} shared a branch with you: ${bulletText}`,
    body: `${owner.name} shared the branch "${bulletText}" with you on Twigline.\n\nOpen it here: ${config.publicUrl}/invite/${token}`,
  };
  let status: ShareStatus;
  try {
    await smtp.send(message);
    status = 'sent';
  } catch {
    status = 'not_sent';
  }
  await pool.query(`update shares set status = $2 where id = $1`, [id, status]);
  const created = await shareByIdInternal(pool, id);
  if (!created) throw new ApiError(404, { error: 'not_found' });
  return created;
}

async function shareByIdInternal(pool: Pool, id: string): Promise<ShareRow | null> {
  const rows = await pool.query(`select * from shares where id = $1`, [id]);
  return rows.rows[0] ? rowToShare(rows.rows[0]) : null;
}

export async function retryShare(
  pool: Pool,
  config: Config,
  smtp: SmtpClient,
  owner: Account,
  shareId: string,
  bulletText: string,
): Promise<ShareRow> {
  const share = await shareByIdInternal(pool, shareId);
  if (!share) throw new ApiError(404, { error: 'not_found' });
  if (share.status !== 'not_sent') {
    throw new ApiError(409, { error: 'not_retryable', message: "That invitation can't be retried." });
  }
  await pool.query(`update shares set status = 'pending_send' where id = $1`, [shareId]);
  const message: MailMessage = {
    from: config.mailFrom,
    to: share.email,
    subject: `${owner.name} shared a branch with you: ${bulletText}`,
    body: `${owner.name} shared the branch "${bulletText}" with you on Twigline.\n\nOpen it here: ${config.publicUrl}/invite/${share.token}`,
  };
  let status: ShareStatus;
  try {
    await smtp.send(message);
    status = 'sent';
  } catch {
    status = 'not_sent';
  }
  await pool.query(`update shares set status = $2 where id = $1`, [shareId, status]);
  const retried = await shareByIdInternal(pool, shareId);
  if (!retried) throw new ApiError(404, { error: 'not_found' });
  return retried;
}

export async function removeShare(
  pool: Pool,
  shareId: string,
): Promise<ShareRow> {
  const share = await shareByIdInternal(pool, shareId);
  if (!share) throw new ApiError(404, { error: 'not_found' });
  if (share.status === 'revoked' || share.status === 'lapsed') {
    throw new ApiError(409, { error: 'share_closed', message: 'That share is already closed.' });
  }
  await pool.query(`update shares set status = 'revoked' where id = $1`, [shareId]);
  return { ...share, status: 'revoked' };
}

export function lapseCheck(share: ShareRow, config: Config): ShareRow {
  if (share.status === 'sent' || share.status === 'not_sent') {
    if (Date.now() - share.createdAt >= config.inviteTtlSeconds * 1000) {
      return { ...share, status: 'lapsed' };
    }
  }
  return share;
}

export async function invitationByToken(
  pool: Pool,
  config: Config,
  token: string,
): Promise<{ share: ShareRow; bulletText: string; inviterName: string } | null> {
  const rows = await pool.query(`select * from shares where token = $1`, [token]);
  const row = rows.rows[0];
  if (!row) return null;
  const share = rowToShare(row);
  if (share.status === 'revoked') return null;
  const lapsed = lapseCheck(share, config);
  if (lapsed.status === 'lapsed') {
    await pool.query(`update shares set status = 'lapsed' where id = $1`, [share.id]);
  }
  const bulletRows = await pool.query(`select text, owner_id from bullets where id = $1`, [share.bulletId]);
  const ownerRows = await pool.query(`select name from accounts where id = $1`, [share.ownerId]);
  return {
    share: lapsed,
    bulletText: String(bulletRows.rows[0]?.text ?? ''),
    inviterName: String(ownerRows.rows[0]?.name ?? ''),
  };
}

export async function acceptShare(
  pool: Pool,
  config: Config,
  token: string,
  account: Account,
): Promise<string> {
  const invitation = await invitationByToken(pool, config, token);
  if (!invitation) throw new ApiError(404, { error: 'not_found' });
  if (invitation.share.status === 'lapsed') {
    throw new ApiError(409, {
      error: 'invitation_lapsed',
      message: 'This invitation has expired. Ask the owner to send a new one.',
    });
  }
  if (account.email !== invitation.share.email) {
    throw new ApiError(409, {
      error: 'wrong_account',
      message: 'This invitation was sent to a different email address.',
    });
  }
  await pool.query(`update shares set status = 'accepted', accepted_at = $2 where id = $1`, [
    invitation.share.id,
    Date.now(),
  ]);
  return invitation.share.bulletId;
}
