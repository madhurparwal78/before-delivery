import { copy } from '../shared/copy.js';
import type { Role } from '../shared/document.js';
import type { User } from './auth.js';
import { query, queryOne } from './db.js';
import { config } from './env.js';
import { conflict, notFound } from './errors.js';
import { broadcast } from './hub.js';
import { newId } from './ids.js';
import { sendMail } from './mail.js';

export type StoredInviteStatus = 'emailed' | 'email_not_sent' | 'accepted' | 'revoked';
export type InviteStatus = 'emailed' | 'email_not_sent' | 'expired';

export interface InviteView {
  id: string;
  email: string;
  role: 'editor' | 'viewer';
  status: InviteStatus;
  expiresAt: string;
}

interface InviteRow extends Record<string, unknown> {
  id: string;
  diagram_id: string;
  email: string;
  role: 'editor' | 'viewer';
  status: StoredInviteStatus;
  issued_at: Date;
  invited_by: string;
}

/**
 * An invite is open while less than INVITE_TTL_MS has passed since it was last created or
 * resent. The server judges this on its own clock at every read and acceptance attempt.
 */
function expiresAt(row: InviteRow): Date {
  return new Date(row.issued_at.getTime() + config.inviteTtlMs);
}

function isOpen(row: InviteRow, now = Date.now()): boolean {
  if (row.status !== 'emailed' && row.status !== 'email_not_sent') return false;
  return now < expiresAt(row).getTime();
}

function viewOf(row: InviteRow): InviteView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: isOpen(row) ? (row.status as InviteStatus) : 'expired',
    expiresAt: expiresAt(row).toISOString(),
  };
}

export interface MemberView {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: 'active';
}

export async function listMembers(diagramId: string): Promise<MemberView[]> {
  const rows = await query<{ user_id: string; email: string; name: string; role: Role }>(
    `SELECT m.user_id, u.email, u.name, m.role
       FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.diagram_id = $1
      ORDER BY (m.role = 'owner') DESC, u.name ASC`,
    [diagramId],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name,
    role: r.role,
    status: 'active' as const,
  }));
}

/** Revoked and accepted invites leave the members response. */
export async function listInvites(diagramId: string): Promise<InviteView[]> {
  const rows = await query<InviteRow>(
    `SELECT id, diagram_id, email, role, status, issued_at, invited_by
       FROM invites WHERE diagram_id = $1 AND status IN ('emailed', 'email_not_sent')
       ORDER BY created_at ASC`,
    [diagramId],
  );
  return rows.map(viewOf);
}

function inviteBody(inviterName: string, title: string, role: 'editor' | 'viewer', diagramId: string): string {
  return [
    `${inviterName} invited you to the Linewell diagram "${title}".`,
    `You can join as ${role === 'editor' ? 'an editor' : 'a viewer'}.`,
    '',
    `Open it here: ${config.publicUrl}/d/${diagramId}`,
    '',
    'Sign in or create an account with this email address and the diagram will be waiting.',
  ].join('\n');
}

/**
 * Creating or resending an invite saves it and then tries to send the email. It becomes
 * `emailed` when the mail server accepts the message and `email_not_sent` otherwise.
 */
async function deliver(
  row: InviteRow,
  inviter: User,
  title: string,
): Promise<StoredInviteStatus> {
  try {
    await sendMail({
      to: row.email,
      subject: copy.inviteSubject(inviter.name, title, row.role),
      body: inviteBody(inviter.name, title, row.role, row.diagram_id),
    });
    return 'emailed';
  } catch {
    return 'email_not_sent';
  }
}

export async function createInvite(
  diagramId: string,
  title: string,
  inviter: User,
  email: string,
  role: 'editor' | 'viewer',
): Promise<InviteView> {
  const member = await queryOne<{ id: string }>(
    `SELECT u.id FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.diagram_id = $1 AND lower(u.email) = lower($2)`,
    [diagramId, email],
  );
  if (member) throw conflict('already_member', 'That person is already a member.');

  const existing = await query<InviteRow>(
    `SELECT id, diagram_id, email, role, status, issued_at, invited_by FROM invites
      WHERE diagram_id = $1 AND lower(email) = lower($2) AND status IN ('emailed', 'email_not_sent')`,
    [diagramId, email],
  );
  const open = existing.find((row) => isOpen(row));
  if (open) throw conflict('already_invited', 'That person already has an open invite.');
  // An expired invite is replaced by the new one.
  for (const row of existing) {
    await query("UPDATE invites SET status = 'revoked' WHERE id = $1", [row.id]);
  }

  const id = newId('i');
  const rows = await query<InviteRow>(
    `INSERT INTO invites (id, diagram_id, email, role, status, invited_by)
     VALUES ($1, $2, $3, $4, 'email_not_sent', $5)
     RETURNING id, diagram_id, email, role, status, issued_at, invited_by`,
    [id, diagramId, email, role, inviter.id],
  );
  const row = rows[0];
  if (!row) throw notFound();
  await query('INSERT INTO object_ids (diagram_id, id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
    diagramId,
    id,
    'invite',
  ]);
  const status = await deliver(row, inviter, title);
  const updated = await query<InviteRow>(
    `UPDATE invites SET status = $2 WHERE id = $1
     RETURNING id, diagram_id, email, role, status, issued_at, invited_by`,
    [id, status],
  );
  broadcast(diagramId, { t: 'members' });
  return viewOf(updated[0] ?? row);
}

async function loadInvite(diagramId: string, inviteId: string): Promise<InviteRow> {
  const row = await queryOne<InviteRow>(
    `SELECT id, diagram_id, email, role, status, issued_at, invited_by FROM invites
      WHERE diagram_id = $1 AND id = $2`,
    [diagramId, inviteId],
  );
  if (!row) throw notFound();
  return row;
}

/** Resend is allowed from emailed, email_not_sent and expired. It sets a fresh expiry. */
export async function resendInvite(
  diagramId: string,
  title: string,
  inviter: User,
  inviteId: string,
): Promise<InviteView> {
  const row = await loadInvite(diagramId, inviteId);
  if (row.status === 'accepted' || row.status === 'revoked') {
    throw conflict('invite_closed', 'That invite is closed.');
  }
  const refreshed = await query<InviteRow>(
    `UPDATE invites SET issued_at = now() WHERE id = $1
     RETURNING id, diagram_id, email, role, status, issued_at, invited_by`,
    [inviteId],
  );
  const current = refreshed[0] ?? row;
  const status = await deliver(current, inviter, title);
  const updated = await query<InviteRow>(
    `UPDATE invites SET status = $2 WHERE id = $1
     RETURNING id, diagram_id, email, role, status, issued_at, invited_by`,
    [inviteId, status],
  );
  broadcast(diagramId, { t: 'members' });
  return viewOf(updated[0] ?? current);
}

export async function revokeInvite(diagramId: string, inviteId: string): Promise<void> {
  const row = await loadInvite(diagramId, inviteId);
  if (row.status === 'accepted' || row.status === 'revoked') {
    throw conflict('invite_closed', 'That invite is closed.');
  }
  await query("UPDATE invites SET status = 'revoked' WHERE id = $1", [inviteId]);
  broadcast(diagramId, { t: 'members' });
}

/**
 * An open invite becomes accepted when a person signs up or signs in with the invited
 * email, compared without case. An expired invite grants no access.
 */
export async function acceptOpenInvites(user: User): Promise<void> {
  const rows = await query<InviteRow>(
    `SELECT id, diagram_id, email, role, status, issued_at, invited_by FROM invites
      WHERE lower(email) = lower($1) AND status IN ('emailed', 'email_not_sent')`,
    [user.email],
  );
  const now = Date.now();
  for (const row of rows) {
    if (!isOpen(row, now)) continue;
    await query(
      `INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (diagram_id, user_id) DO NOTHING`,
      [row.diagram_id, user.id, row.role],
    );
    await query(
      'INSERT INTO object_ids (diagram_id, id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [row.diagram_id, user.id, 'member'],
    );
    await query("UPDATE invites SET status = 'accepted' WHERE id = $1", [row.id]);
    broadcast(row.diagram_id, { t: 'members' });
  }
}
