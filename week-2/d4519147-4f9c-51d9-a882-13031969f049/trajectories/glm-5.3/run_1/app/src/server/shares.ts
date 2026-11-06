// The share state machine, invitation tokens and their limits.

import type { PoolClient } from 'pg';
import crypto from 'node:crypto';
import { AppTimers, INVITE_LOOKUP_LIMIT, INVITE_RATE_LIMIT } from '../shared/constants.js';
import { errors } from './errors.js';
import { newToken, sha256 } from './security.js';
import { queueMail, QueuedInviteMail, QueuedNoticeMail } from './mail.js';

export interface ShareContext {
  client: PoolClient;
  now: Date;
  timers: AppTimers;
  actor: string;
}

export interface AuditContext {
  client: PoolClient;
  now: Date;
  actor: string;
}

export type ShareStatus = 'invited' | 'active' | 'expired' | 'revoked' | 'withdrawn';

export interface ShareRow {
  id: string;
  diagram_id: string;
  email: string;
  display_name: string | null;
  role: 'editor' | 'viewer';
  status: ShareStatus;
  token_hash: string | null;
  expires_at: Date | null;
  created_at: Date;
  used_at: Date | null;
}

// Status is judged by server time at the request.
export function effectiveStatus(share: ShareRow, now: Date): ShareStatus {
  if (share.status === 'invited' && share.expires_at !== null && share.expires_at <= now) {
    return 'expired';
  }
  return share.status;
}

export async function getShare(client: PoolClient, diagramId: string, shareId: string): Promise<ShareRow | null> {
  const rows = await client.query<ShareRow>(
    'SELECT id, diagram_id, email, display_name, role, status, token_hash, expires_at, created_at, used_at FROM shares WHERE diagram_id = $1 AND id = $2',
    [diagramId, shareId],
  );
  return rows.rowCount === 0 ? null : rows.rows[0];
}

// ---------------------------------------------------------------------------
// Invitation rate limit: at most 20 invitations per diagram per rolling hour.
// Replacements count; refused requests do not.

export async function checkInviteRateLimit(
  ctx: { client: PoolClient; now: Date; timers: AppTimers },
  diagramId: string,
): Promise<void> {
  const windowStart = new Date(ctx.now.getTime() - ctx.timers.inviteRateWindowSeconds * 1000);
  const rows = await ctx.client.query<{ at: Date }>(
    `SELECT created_at AS at FROM shares
     WHERE diagram_id = $1 AND status IN ('invited', 'expired', 'withdrawn', 'revoked', 'active')
       AND created_at >= $2
     ORDER BY created_at ASC`,
    [diagramId, windowStart],
  );
  const counted = rows.rows;
  if (counted.length >= INVITE_RATE_LIMIT) {
    const oldest = counted[0];
    const until = new Date(oldest.at.getTime() + ctx.timers.inviteRateWindowSeconds * 1000);
    const wait = Math.max(1, Math.ceil((until.getTime() - ctx.now.getTime()) / 1000));
    throw errors.inviteRateLimited(wait);
  }
}

// ---------------------------------------------------------------------------
// Failed-lookup limit: 20 failed invitation lookups per IP within the window.

export async function recordFailedLookup(ctx: { client: PoolClient; now: Date; timers: AppTimers }, ip: string): Promise<void> {
  await ctx.client.query('INSERT INTO invite_lookups (ip, at) VALUES ($1, $2)', [ip, ctx.now]);
}

export async function checkLookupLimit(ctx: { client: PoolClient; now: Date; timers: AppTimers }, ip: string): Promise<void> {
  const windowStart = new Date(ctx.now.getTime() - ctx.timers.inviteLookupWindowSeconds * 1000);
  const rows = await ctx.client.query<{ at: Date }>(
    `SELECT at FROM invite_lookups WHERE ip = $1 AND at >= $2 ORDER BY at ASC`,
    [ip, windowStart],
  );
  if (rows.rows.length >= INVITE_LOOKUP_LIMIT) {
    const anchor = rows.rows[rows.rows.length - INVITE_LOOKUP_LIMIT];
    const until = new Date(anchor.at.getTime() + ctx.timers.inviteLookupWindowSeconds * 1000);
    const wait = Math.max(1, Math.ceil((until.getTime() - ctx.now.getTime()) / 1000));
    throw errors.inviteLookupLimited(wait);
  }
}

// ---------------------------------------------------------------------------
// Invites and transitions. Each writes its audit event and queues its mail
// in the caller's transaction.

export interface InviteResult {
  share: ShareRow;
}

export async function inviteShare(
  ctx: ShareContext,
  diagramId: string,
  diagramTitle: string,
  inviterName: string,
  ownerEmail: string,
  email: string,
  role: 'editor' | 'viewer',
): Promise<InviteResult> {
  const lowerEmail = email.trim().toLowerCase();
  await checkInviteRateLimit(ctx, diagramId);
  if (lowerEmail === ownerEmail.toLowerCase()) throw errors.alreadyMember();
  const active = await ctx.client.query<{ id: string }>(
    `SELECT id FROM shares WHERE diagram_id = $1 AND lower(email) = lower($2) AND status = 'active'`,
    [diagramId, lowerEmail],
  );
  if (active.rowCount !== 0) throw errors.alreadyMember();
  const pending = await ctx.client.query<ShareRow>(
    `SELECT id, diagram_id, email, display_name, role, status, token_hash, expires_at, created_at, used_at
     FROM shares WHERE diagram_id = $1 AND lower(email) = lower($2) AND status = 'invited'`,
    [diagramId, lowerEmail],
  );
  if (pending.rowCount !== 0) {
    const row = pending.rows[0];
    if (effectiveStatus(row, ctx.now) !== 'expired') throw errors.invitePending();
    // Replacement: the expired share becomes withdrawn and its token dies.
    await withdrawExpiredShare(ctx, row);
  }
  // Simultaneous invites for one email: the unique index makes exactly one win.
  const token = newToken();
  const expiresAt = new Date(ctx.now.getTime() + ctx.timers.inviteTtlSeconds * 1000);
  const id = `shr-${crypto.randomUUID()}`;
  const inviteMail: QueuedInviteMail = {
    kind: 'invite',
    to: lowerEmail,
    inviteeName: null,
    inviterName,
    diagramTitle,
    role,
    token,
    expiresAt,
  };
  try {
    const inserted = await ctx.client.query<ShareRow>(
      `INSERT INTO shares (id, diagram_id, email, display_name, role, status, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, NULL, $4, 'invited', $5, $6, $7)
       RETURNING id, diagram_id, email, display_name, role, status, token_hash, expires_at, created_at, used_at`,
      [id, diagramId, lowerEmail, role, sha256(token), expiresAt, ctx.now],
    );
    await queueMail(ctx, inviteMail, diagramId);
    await writeDiagramEvent(ctx, diagramId, 'share.invited', { email: lowerEmail, role });
    return { share: inserted.rows[0] };
  } catch (err) {
    if (isUniqueViolation(err)) {
      // A simultaneous invite for the same email won the race.
      throw errors.invitePending();
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
}

export interface AuditContext {
  client: PoolClient;
  now: Date;
  actor: string;
}

export async function writeDiagramEvent(
  ctx: AuditContext,
  diagramId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await ctx.client.query(
    `INSERT INTO audit_events (at, actor, action, detail, diagram_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [ctx.now, ctx.actor, action, JSON.stringify(detail), diagramId],
  );
}

// Replace an expired share: it becomes withdrawn, its token dies.
export async function withdrawExpiredShare(
  ctx: ShareContext,
  share: ShareRow,
): Promise<void> {
  await ctx.client.query(
    `UPDATE shares SET status = 'withdrawn', token_hash = NULL WHERE id = $1`,
    [share.id],
  );
  await writeDiagramEvent(ctx, share.diagram_id, 'share.withdrawn', { email: share.email });
}

// Accept: invited becomes active, exactly once. Expired links answer 410,
// used or withdrawn ones 404.
export async function acceptShare(
  ctx: ShareContext,
  share: ShareRow,
  personEmail: string,
): Promise<void> {
  if (share.status !== 'invited') throw errors.inviteUsed();
  if (effectiveStatus(share, ctx.now) === 'expired') throw errors.inviteExpired();
  const updated = await ctx.client.query(
    `UPDATE shares SET status = 'active', used_at = $1, display_name = (
       SELECT display_name FROM people WHERE lower(email) = lower($2)
     ) WHERE id = $3 AND status = 'invited'`,
    [ctx.now, personEmail, share.id],
  );
  if (updated.rowCount === 0) throw errors.inviteUsed();
  await writeDiagramEvent(ctx, share.diagram_id, 'share.accepted', { email: share.email, role: share.role });
}

// Role change on an active share. Editor to viewer queues the notice.
export async function changeShareRole(
  ctx: ShareContext,
  share: ShareRow,
  newRole: 'editor' | 'viewer',
  diagramTitle: string,
): Promise<void> {
  const status = effectiveStatus(share, ctx.now);
  if (status === 'invited' || status === 'expired') {
    throw errors.sharePending();
  }
  if (share.status === 'revoked' || share.status === 'withdrawn') {
    throw errors.shareEnded();
  }
  if (share.role === newRole) {
    // Setting the current role again answers 200, with no change and no email.
    return;
  }
  const updated = await ctx.client.query(
    `UPDATE shares SET role = $1 WHERE id = $2 AND status = 'active'`,
    [newRole, share.id],
  );
  if (updated.rowCount === 0) throw errors.shareEnded();
  await writeDiagramEvent(ctx, share.diagram_id, 'share.role_changed', { email: share.email, from: share.role, to: newRole });
  if (share.role === 'editor' && newRole === 'viewer') {
    const notice: QueuedNoticeMail = { kind: 'downgrade', to: share.email, diagramTitle };
    await queueMail(ctx, notice, share.diagram_id);
  }
}

// Remove: invited or expired becomes withdrawn, active becomes revoked.
export async function removeShare(
  ctx: ShareContext,
  share: ShareRow,
  diagramTitle: string,
): Promise<void> {
  const status = effectiveStatus(share, ctx.now);
  if (share.status === 'revoked' || share.status === 'withdrawn') {
    throw errors.shareEnded();
  }
  const nextStatus = status === 'active' ? 'revoked' : 'withdrawn';
  const updated = await ctx.client.query(
    `UPDATE shares SET status = $1, token_hash = NULL WHERE id = $2 AND status = $3`,
    [nextStatus, share.id, share.status],
  );
  if (updated.rowCount === 0) throw errors.shareEnded();
  const action = nextStatus === 'revoked' ? 'share.revoked' : 'share.withdrawn';
  await writeDiagramEvent(ctx, share.diagram_id, action, { email: share.email });
  if (nextStatus === 'revoked') {
    const notice: QueuedNoticeMail = { kind: 'revoked', to: share.email, diagramTitle };
    await queueMail(ctx, notice, share.diagram_id);
  }
}

// Find a share by invitation token. Used and withdrawn tokens answer null.
export async function findShareByToken(client: PoolClient, token: string): Promise<ShareRow | null> {
  const rows = await client.query<ShareRow>(
    `SELECT id, diagram_id, email, display_name, role, status, token_hash, expires_at, created_at, used_at
     FROM shares WHERE token_hash = $1`,
    [sha256(token)],
  );
  return rows.rowCount === 0 ? null : rows.rows[0];
}
