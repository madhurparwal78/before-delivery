import { INVITE_RATE_LIMIT, config } from '../config';
import { newId, randomToken, sha256Hex } from '../crypto';
import { query, type PoolClient } from '../db';
import { errors } from '../http/errors';
import type { ShareRow, ShareStatus } from '../../shared/types';
import { enqueueMessage } from '../services/queue';
import { writeDiagramEvent } from './audit';
import { accessChangedMessage, invitationMessage } from './messages';

interface ShareDbRow {
  id: string;
  diagram_id: string;
  email: string;
  role: 'editor' | 'viewer';
  status: 'invited' | 'active' | 'revoked' | 'withdrawn';
  token_hash: string | null;
  expires_at: Date | null;
  delivery: 'sent' | 'queued';
  display_name: string | null;
}

const SHARE_COLUMNS = `s.id, s.diagram_id, s.email, s.role, s.status, s.token_hash, s.expires_at, s.delivery,
  (select u.display_name from users u where u.email = s.email) as display_name`;

/** The share state machine's single view of a row's status, judged by server time. */
export function effectiveStatus(row: { status: string; expires_at: Date | null }): ShareStatus {
  if (row.status === 'invited' && row.expires_at && row.expires_at.getTime() <= Date.now()) return 'expired';
  return row.status as ShareStatus;
}

function toApi(row: ShareDbRow): ShareRow {
  const status = effectiveStatus(row);
  if (status !== 'invited' && status !== 'expired' && status !== 'active') throw new Error('share not listable');
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status,
    delivery: row.delivery,
    expiresAt: status === 'active' ? null : (row.expires_at?.toISOString() ?? null),
  };
}

export async function listShares(diagramId: string): Promise<ShareRow[]> {
  const rows = await query<ShareDbRow>(
    `select ${SHARE_COLUMNS} from shares s
     where s.diagram_id = $1 and s.status in ('invited', 'active')
     order by s.created_at, s.id`,
    [diagramId],
  );
  return rows.map(toApi);
}

export const VALID_EMAIL = /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const email = raw.trim();
  if (email.length === 0 || email.length > 254) return false;
  if (email.split('@').length !== 2) return false;
  return VALID_EMAIL.test(email);
}

export interface InviteContext {
  diagramId: string;
  diagramTitle: string;
  inviterName: string;
  actorEmail: string;
}

export async function inviteRateState(diagramId: string): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const rows = await query<{ created_at: Date }>(
    `select created_at from shares
     where diagram_id = $1 and token_hash_issued and created_at > now() - interval '1 second' * $2
     order by created_at`,
    [diagramId, config.inviteRateWindowSeconds],
  );
  if (rows.length < INVITE_RATE_LIMIT) return { limited: false, retryAfterSeconds: 0 };
  const oldest = rows[0];
  if (!oldest) return { limited: false, retryAfterSeconds: 0 };
  const waitMs = oldest.created_at.getTime() + config.inviteRateWindowSeconds * 1000 - Date.now();
  return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
}

/** Creates an invited share, replacing an expired one, and queues its email. */
export async function createInvitation(
  client: PoolClient,
  context: InviteContext,
  email: string,
  role: 'editor' | 'viewer',
): Promise<ShareRow> {
  const existing = await client.query<ShareDbRow>(
    `select ${SHARE_COLUMNS} from shares s where s.diagram_id = $1 and s.email = $2
      and s.status in ('invited', 'active') for update`,
    [context.diagramId, email],
  );
  const current = existing.rows[0];
  if (current) {
    const status = effectiveStatus(current);
    if (status === 'active') throw errors.conflict('already_member', 'This person already has access.');
    if (status === 'invited') throw errors.conflict('invite_pending', 'An invitation to this email is already pending.');
    await client.query(`update shares set status = 'withdrawn', token_hash = null, updated_at = now() where id = $1`, [
      current.id,
    ]);
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.inviteTtlSeconds * 1000);
  const id = newId();
  try {
    await client.query(
      `insert into shares (id, diagram_id, email, role, status, token_hash, token_hash_issued, expires_at, delivery)
       values ($1, $2, $3, $4, 'invited', $5, true, $6, 'queued')`,
      [id, context.diagramId, email, role, sha256Hex(token), expiresAt],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.conflict('invite_pending', 'An invitation to this email is already pending.');
    }
    throw error;
  }
  await enqueueMessage(client, {
    diagramId: context.diagramId,
    shareId: id,
    kind: 'invitation',
    message: invitationMessage({
      to: email,
      inviterName: context.inviterName,
      diagramTitle: context.diagramTitle,
      role,
      token,
      expiresAt,
    }),
  });
  await writeDiagramEvent(client, context.diagramId, context.actorEmail, 'share.invited', { email, role });
  const created = await client.query<ShareDbRow>(`select ${SHARE_COLUMNS} from shares s where s.id = $1`, [id]);
  const row = created.rows[0];
  if (!row) throw errors.internal();
  return toApi(row);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export async function loadShareForUpdate(
  client: PoolClient,
  diagramId: string,
  shareId: string,
): Promise<ShareDbRow | null> {
  const result = await client.query<ShareDbRow>(
    `select ${SHARE_COLUMNS} from shares s where s.id = $1 and s.diagram_id = $2 for update`,
    [shareId, diagramId],
  );
  return result.rows[0] ?? null;
}

export async function changeShareRole(
  client: PoolClient,
  context: InviteContext,
  row: ShareDbRow,
  role: 'editor' | 'viewer',
): Promise<ShareRow> {
  const status = effectiveStatus(row);
  if (status === 'invited' || status === 'expired') {
    throw errors.conflict('share_pending', 'This invitation has not been accepted yet.');
  }
  if (status === 'revoked' || status === 'withdrawn') {
    throw errors.conflict('share_ended', 'This share has already ended.');
  }
  if (row.role === role) return toApi(row);
  await client.query('update shares set role = $2, updated_at = now() where id = $1', [row.id, role]);
  if (row.role === 'editor' && role === 'viewer') {
    await enqueueMessage(client, {
      diagramId: context.diagramId,
      shareId: row.id,
      kind: 'access_changed',
      message: accessChangedMessage({ to: row.email, diagramTitle: context.diagramTitle, change: 'downgraded' }),
    });
  }
  await writeDiagramEvent(client, context.diagramId, context.actorEmail, 'share.role_changed', {
    email: row.email,
    from: row.role,
    to: role,
  });
  const updated = await client.query<ShareDbRow>(`select ${SHARE_COLUMNS} from shares s where s.id = $1`, [row.id]);
  const next = updated.rows[0];
  if (!next) throw errors.internal();
  return toApi(next);
}

export async function removeShare(client: PoolClient, context: InviteContext, row: ShareDbRow): Promise<void> {
  const status = effectiveStatus(row);
  if (status === 'revoked' || status === 'withdrawn') {
    throw errors.conflict('share_ended', 'This share has already ended.');
  }
  if (status === 'active') {
    await client.query(`update shares set status = 'revoked', updated_at = now() where id = $1`, [row.id]);
    await enqueueMessage(client, {
      diagramId: context.diagramId,
      shareId: row.id,
      kind: 'access_changed',
      message: accessChangedMessage({ to: row.email, diagramTitle: context.diagramTitle, change: 'revoked' }),
    });
    await writeDiagramEvent(client, context.diagramId, context.actorEmail, 'share.revoked', { email: row.email });
    return;
  }
  await client.query(
    `update shares set status = 'withdrawn', token_hash = null, updated_at = now() where id = $1`,
    [row.id],
  );
  await writeDiagramEvent(client, context.diagramId, context.actorEmail, 'share.withdrawn', { email: row.email });
}

export interface InviteLookup {
  id: string;
  diagramId: string;
  diagramTitle: string;
  inviterName: string;
  email: string;
  role: 'editor' | 'viewer';
  status: ShareStatus;
  accountExists: boolean;
}

export async function lookupInviteToken(token: string): Promise<InviteLookup | null> {
  const rows = await query<{
    id: string;
    diagram_id: string;
    email: string;
    role: 'editor' | 'viewer';
    status: string;
    expires_at: Date | null;
    title: string;
    owner_name: string;
    account_exists: boolean;
  }>(
    `select s.id, s.diagram_id, s.email, s.role, s.status, s.expires_at, d.title, o.display_name as owner_name,
            exists(select 1 from users u where u.email = s.email) as account_exists
     from shares s
       join diagrams d on d.id = s.diagram_id
       join users o on o.id = d.owner_id
     where s.token_hash = $1`,
    [sha256Hex(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    diagramId: row.diagram_id,
    diagramTitle: row.title,
    inviterName: row.owner_name,
    email: row.email,
    role: row.role,
    status: effectiveStatus(row),
    accountExists: row.account_exists,
  };
}

export async function recordInviteLookupFailure(ip: string): Promise<void> {
  await query('insert into invite_lookup_failures (ip) values ($1)', [ip]);
  await query(`delete from invite_lookup_failures where at < now() - interval '1 second' * $1`, [
    config.inviteLookupWindowSeconds * 4,
  ]);
}

export async function inviteLookupState(ip: string): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const rows = await query<{ at: Date }>(
    `select at from invite_lookup_failures
     where ip = $1 and at > now() - interval '1 second' * $2
     order by at`,
    [ip, config.inviteLookupWindowSeconds],
  );
  if (rows.length < 20) return { limited: false, retryAfterSeconds: 0 };
  const oldest = rows[0];
  if (!oldest) return { limited: false, retryAfterSeconds: 0 };
  const waitMs = oldest.at.getTime() + config.inviteLookupWindowSeconds * 1000 - Date.now();
  return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
}
