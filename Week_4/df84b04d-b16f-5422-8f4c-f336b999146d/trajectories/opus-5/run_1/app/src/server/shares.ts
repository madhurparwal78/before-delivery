import { randomBytes, randomUUID } from 'node:crypto';
import { fixed } from '../shared/copy.js';
import { displayText, type ShareRow, type ShareStatus } from '../shared/types.js';
import { config } from './config.js';
import { pool, query } from './db.js';
import { conflict, invalid, notFound } from './errors.js';
import { revokeSockets } from './live.js';
import { sendInvitation } from './mail.js';
import { scopeForBullet, type Viewer } from './scope.js';
import { loadTree } from './tree.js';

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

interface StoredShare {
  id: string;
  bullet_id: string;
  owner_id: string;
  email: string;
  token: string;
  status: ShareStatus;
  created_at: Date;
}

/** The invitation state machine, judged on read so time limits apply everywhere. */
export function effectiveStatus(share: StoredShare): ShareStatus {
  if (share.status === 'sent' || share.status === 'not_sent') {
    const lapsesAt = share.created_at.getTime() + config.inviteTtlSeconds * 1_000;
    if (Date.now() >= lapsesAt) return 'lapsed';
  }
  return share.status;
}

const OPEN_STATES: ShareStatus[] = ['pending_send', 'sent', 'not_sent', 'accepted'];

async function storedShare(id: string): Promise<StoredShare | null> {
  const rows = await query<StoredShare>(
    `select id, bullet_id, owner_id, email, token, status, created_at from shares where id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function sharesOfBullet(bulletId: string): Promise<StoredShare[]> {
  return query<StoredShare>(
    `select id, bullet_id, owner_id, email, token, status, created_at
       from shares where bullet_id = $1 order by created_at`,
    [bulletId]
  );
}

/** The owner's own bullet, or not found for anybody else. */
async function requireOwnedBullet(viewer: Viewer, bulletId: string): Promise<string> {
  const { scope, tree } = await scopeForBullet(viewer, bulletId);
  if (scope.shareRootId !== null) throw notFound();
  const row = tree.row(bulletId);
  if (row === undefined) throw notFound();
  const original = tree.original(row);
  if (original === undefined) throw notFound();
  return displayText({ text: original.text, placeholder: false });
}

export async function listShares(viewer: Viewer, bulletId: string): Promise<ShareRow[]> {
  await requireOwnedBullet(viewer, bulletId);
  const shares = await sharesOfBullet(bulletId);
  return shares
    .map((share) => ({
      id: share.id,
      email: share.email,
      status: effectiveStatus(share),
      createdAt: share.created_at.toISOString()
    }))
    .filter((share) => share.status !== 'revoked');
}

async function handToMail(share: StoredShare, inviterName: string, bulletText: string): Promise<ShareStatus> {
  const accepted = await sendInvitation(share.email, inviterName, bulletText, share.token);
  const status: ShareStatus = accepted ? 'sent' : 'not_sent';
  await pool.query(
    `update shares set status = $2, sent_at = case when $2 = 'sent' then now() else null end
      where id = $1`,
    [share.id, status]
  );
  return status;
}

export async function createShare(
  viewer: Viewer,
  bulletId: string,
  rawEmail: unknown
): Promise<{ id: string; email: string; status: ShareStatus }> {
  const bulletText = await requireOwnedBullet(viewer, bulletId);
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!EMAIL.test(email)) throw invalid({ email: fixed.emailInvalid });
  if (email === viewer.email) throw invalid({ email: fixed.inviteSelf });
  const existing = await sharesOfBullet(bulletId);
  if (existing.some((share) => share.email === email && OPEN_STATES.includes(effectiveStatus(share)))) {
    throw conflict('already_invited');
  }
  const share: StoredShare = {
    id: randomUUID(),
    bullet_id: bulletId,
    owner_id: viewer.userId,
    email,
    token: randomBytes(24).toString('hex'),
    status: 'pending_send',
    created_at: new Date()
  };
  await pool.query(
    `insert into shares (id, bullet_id, owner_id, email, token, status) values ($1,$2,$3,$4,$5,'pending_send')`,
    [share.id, share.bullet_id, share.owner_id, share.email, share.token]
  );
  const status = await handToMail(share, viewer.name, bulletText);
  return { id: share.id, email, status };
}

export async function retryShare(
  viewer: Viewer,
  shareId: string
): Promise<{ id: string; email: string; status: ShareStatus }> {
  const share = await storedShare(shareId);
  if (share === null || share.owner_id !== viewer.userId) throw notFound();
  if (effectiveStatus(share) !== 'not_sent') throw conflict('not_retryable');
  const bulletText = await requireOwnedBullet(viewer, share.bullet_id);
  await pool.query(`update shares set status = 'pending_send' where id = $1`, [shareId]);
  const status = await handToMail(share, viewer.name, bulletText);
  return { id: share.id, email: share.email, status };
}

export async function revokeShare(
  viewer: Viewer,
  shareId: string
): Promise<{ id: string; email: string; status: ShareStatus }> {
  const share = await storedShare(shareId);
  if (share === null || share.owner_id !== viewer.userId) throw notFound();
  const status = effectiveStatus(share);
  if (status === 'revoked' || status === 'lapsed') throw conflict('share_closed');
  await pool.query(`update shares set status = 'revoked' where id = $1`, [shareId]);
  revokeSockets(share.owner_id, share.email);
  return { id: share.id, email: share.email, status: 'revoked' };
}

export interface InvitationCard {
  email: string;
  bulletText: string;
  inviter: { name: string };
  status: ShareStatus;
}

export async function readInvitation(token: string): Promise<InvitationCard> {
  const rows = await query<StoredShare & { inviter_name: string }>(
    `select s.id, s.bullet_id, s.owner_id, s.email, s.token, s.status, s.created_at, u.name as inviter_name
       from shares s join users u on u.id = s.owner_id
      where s.token = $1`,
    [token]
  );
  const share = rows[0];
  if (share === undefined) throw notFound();
  const status = effectiveStatus(share);
  if (status === 'revoked') throw notFound();
  const tree = await loadTree(share.owner_id);
  const row = tree.row(share.bullet_id);
  if (row === undefined) throw notFound();
  const original = tree.original(row);
  return {
    email: share.email,
    bulletText: displayText({ text: original?.text ?? '', placeholder: original === undefined }),
    inviter: { name: share.inviter_name },
    status
  };
}

export async function acceptInvitation(viewer: Viewer, token: string): Promise<string> {
  const rows = await query<StoredShare>(
    `select id, bullet_id, owner_id, email, token, status, created_at from shares where token = $1`,
    [token]
  );
  const share = rows[0];
  if (share === undefined) throw notFound();
  const status = effectiveStatus(share);
  if (status === 'revoked') throw notFound();
  if (viewer.email !== share.email) throw conflict('wrong_account');
  if (status === 'lapsed') throw conflict('invitation_lapsed');
  const tree = await loadTree(share.owner_id);
  if (tree.row(share.bullet_id) === undefined) throw notFound();
  await pool.query(`update shares set status = 'accepted' where id = $1`, [share.id]);
  return share.bullet_id;
}
