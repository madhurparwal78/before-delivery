import crypto from 'node:crypto';
import { ACCESS_LABELS, copy } from '../shared/copy';
import type { ShareRow } from '../shared/api';
import { config } from './config';
import { linkExpiryInstant, type WorkspaceRecord } from './clock';
import { one, query } from './db';
import { ApiError } from './errors';

export interface ShareRecord {
  id: string;
  drawing_id: string;
  token: string;
  access: 'view' | 'markup' | 'edit';
  recipient_email: string;
  recipient_name: string;
  expiry_date: string | null;
  revoked_at: Date | null;
  created_at: Date;
}

export type LinkStatus = 'active' | 'expired' | 'revoked';

/** The one place a share link's status is decided. */
export function shareStatus(share: ShareRecord, workspace: WorkspaceRecord, now: Date): LinkStatus {
  if (share.revoked_at !== null) return 'revoked';
  const expiresAt = linkExpiryInstant(share.expiry_date, workspace.time_zone);
  if (expiresAt !== null && now.getTime() >= expiresAt.getTime()) return 'expired';
  return 'active';
}

export function assertLinkUsable(status: LinkStatus): void {
  if (status === 'revoked') throw new ApiError('link_revoked');
  if (status === 'expired') throw new ApiError('link_expired');
}

export async function findShareByToken(token: string): Promise<ShareRecord | null> {
  return await one<ShareRecord>('select * from shares where token = $1', [token]);
}

export async function findShareById(id: string): Promise<ShareRecord | null> {
  return await one<ShareRecord>('select * from shares where id = $1', [id]);
}

export async function listShares(drawingId: string): Promise<ShareRecord[]> {
  return await query<ShareRecord>('select * from shares where drawing_id = $1 order by created_at', [drawingId]);
}

export async function createShare(options: {
  drawingId: string;
  access: 'view' | 'markup' | 'edit';
  recipientEmail: string;
  recipientName: string;
  expiryDate: string | null;
  now: Date;
}): Promise<ShareRecord> {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const rows = await query<ShareRecord>(
    `insert into shares (id, drawing_id, token, access, recipient_email, recipient_name, expiry_date, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [
      id,
      options.drawingId,
      token,
      options.access,
      options.recipientEmail,
      options.recipientName,
      options.expiryDate,
      options.now,
    ],
  );
  return rows[0]!;
}

export async function revokeShare(share: ShareRecord, now: Date): Promise<ShareRecord> {
  if (share.revoked_at !== null) return share;
  const rows = await query<ShareRecord>('update shares set revoked_at = $2 where id = $1 returning *', [
    share.id,
    now,
  ]);
  return rows[0]!;
}

export function shareUrl(token: string): string {
  return `${config.publicUrl}/s/${token}`;
}

export function serializeShare(share: ShareRecord, workspace: WorkspaceRecord, now: Date): ShareRow {
  const expiresAt = linkExpiryInstant(share.expiry_date, workspace.time_zone);
  return {
    id: share.id,
    token: share.token,
    url: shareUrl(share.token),
    access: share.access,
    recipient_email: share.recipient_email,
    recipient_name: share.recipient_name,
    expires_at: expiresAt === null ? null : expiresAt.toISOString(),
    time_zone: workspace.time_zone,
    status: shareStatus(share, workspace, now),
  };
}

export function expiryLabel(share: ShareRecord, workspace: WorkspaceRecord): string {
  return copy.access.linkExpires(linkExpiryInstant(share.expiry_date, workspace.time_zone), workspace.time_zone);
}

export function accessLabel(access: ShareRecord['access']): string {
  return ACCESS_LABELS[access];
}

/** A second invite for the same drawing and address inside the cooldown is refused. */
export async function inviteCooldownRemaining(drawingId: string, email: string, now: Date): Promise<number> {
  const record = await one<{ sent_at: Date }>(
    'select sent_at from invites where drawing_id = $1 and lower(email) = lower($2)',
    [drawingId, email],
  );
  if (record === null) return 0;
  const elapsed = Math.floor((now.getTime() - record.sent_at.getTime()) / 1000);
  const remaining = config.inviteCooldownSeconds - elapsed;
  return remaining > 0 ? remaining : 0;
}

export async function recordInvite(drawingId: string, email: string, now: Date): Promise<void> {
  await query(
    `insert into invites (drawing_id, email, sent_at) values ($1, lower($2), $3)
     on conflict (drawing_id, email) do update set sent_at = excluded.sent_at`,
    [drawingId, email, now],
  );
}
