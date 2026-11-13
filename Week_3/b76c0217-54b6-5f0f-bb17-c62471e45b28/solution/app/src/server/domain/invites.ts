// Invites: a single-use, expiring link sent by mail; held and retried while mail is unavailable.

import { db, type Db } from '../db';
import { fail } from '../errors';
import { config } from '../config';
import { emit } from '../events';
import { MailUnavailableError, sendMail } from '../mail';
import { copy } from '../../shared/copy';
import type { InviteJson, InviteStatus } from '../../shared/types';

export interface InviteRow {
  id: string;
  teamId: string;
  inviterId: string;
  email: string;
  role: 'editor' | 'viewer';
  token: string;
  status: InviteStatus;
  createdAt: Date;
  sentAt: Date | null;
  expiresAt: Date;
  expired: boolean;
}

/** An invite is expired once its time is up, unless it was already accepted. */
export const INVITE_COLUMNS = `id, team_id, inviter_id, email, role, token,
  case when status in ('held', 'sent') and expires_at <= now() then 'expired' else status end as status,
  created_at, sent_at, expires_at, (expires_at <= now()) as expired`;

export const inviteJson = (row: InviteRow): InviteJson => ({
  id: row.id,
  email: row.email,
  role: row.role,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  sentAt: row.sentAt?.toISOString() ?? null,
});

export async function loadInvite(source: Db, id: string): Promise<InviteRow | null> {
  const rows = await source.query<InviteRow>(`select ${INVITE_COLUMNS} from invites where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function loadInviteByToken(token: string): Promise<(InviteRow & { teamName: string }) | null> {
  const rows = await db.query<InviteRow & { teamName: string }>(
    `select i.id, i.team_id, i.inviter_id, i.email, i.role, i.token,
            case when i.status in ('held', 'sent') and i.expires_at <= now() then 'expired' else i.status end as status,
            i.created_at, i.sent_at, i.expires_at, (i.expires_at <= now()) as expired, t.name as team_name
       from invites i join teams t on t.id = i.team_id where i.token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

export async function requireInvite(source: Db, id: string): Promise<InviteRow> {
  const row = await loadInvite(source, id);
  if (row === null) {
    throw fail.notFound();
  }
  return row;
}

/** Try to mail an invite. Returns whether the mail server accepted it; the invite is `sent` only then. */
export async function deliverInvite(invite: InviteRow): Promise<boolean> {
  const people = await db.query<{ inviter: string; team: string }>(
    'select u.name as inviter, t.name as team from users u join teams t on t.id = u.team_id where u.id = $1',
    [invite.inviterId],
  );
  const [{ inviter, team }] = people as [{ inviter: string; team: string }];
  try {
    await sendMail({
      to: invite.email,
      subject: copy.subject(inviter, team),
      text: `${inviter} invited you to join ${team} on Galley as ${invite.role === 'editor' ? 'an editor' : 'a viewer'}.\n\nOpen this link to set your name and password:\n\n${config.publicUrl}/invite/${invite.token}\n\nThe link works once and expires.\n`,
    });
  } catch (error) {
    if (error instanceof MailUnavailableError) {
      return false;
    }
    throw error;
  }
  await db.query("update invites set status = 'sent', sent_at = now() where id = $1 and status = 'held'", [invite.id]);
  const sent = await requireInvite(db, invite.id);
  emit('invite', inviteJson(sent), { teamId: sent.teamId });
  return true;
}

let retrying = false;

/** Held invites are retried every MAIL_RETRY_MS until the mail server accepts them. */
export async function retryHeldInvites(): Promise<void> {
  if (retrying) {
    return;
  }
  retrying = true;
  try {
    const held = await db.query<InviteRow>(`select ${INVITE_COLUMNS} from invites where status = 'held' and expires_at > now() order by created_at`);
    for (const invite of held) {
      if (!(await deliverInvite(invite))) {
        break;
      }
    }
  } finally {
    retrying = false;
  }
}
