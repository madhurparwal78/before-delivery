import { pool } from './db';
import { config } from '../config';
import { copy } from '../shared/copy';
import { inviteSubject, inviteBody } from './mail';
import { mailOut } from './mail';
import { events } from './events';
import { newId, newToken } from './ids';

export type InviteRow = {
  id: string; team_id: string; email: string; role: string; status: string;
  created_at: Date; sent_at: Date | null;
};

export function inviteJson(row: InviteRow): { id: string; email: string; role: string; status: string; createdAt: string; sentAt: string | null } {
  return {
    id: row.id, email: row.email, role: row.role, status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  };
}

export async function createInvite(teamId: string, inviterName: string, email: string, role: string): Promise<{ invite: InviteRow; held: boolean }> {
  const id = newId('inv');
  const token = newToken(24);
  const created = await pool.query<InviteRow>(
    `INSERT INTO invites (id, team_id, email, role, status, token) VALUES ($1, $2, $3, $4, 'held', $5) RETURNING *`,
    [id, teamId, email.toLowerCase(), role, token],
  );
  const invite = created.rows[0];
  const sent = await trySend(invite, inviterName);
  return { invite: sent, held: sent.status === 'held' };
}

export async function trySend(invite: InviteRow, inviterName: string): Promise<InviteRow> {
  if (mailOut()) {
    events.invite(invite.team_id, inviteJson(invite));
    return invite;
  }
  try {
    const team = await pool.query<{ name: string }>('SELECT name FROM teams WHERE id = $1', [invite.team_id]);
    const { sendInviteMail } = await import('./mail');
    await sendInviteMail(invite.email, inviteSubject(inviterName, team.rows[0].name), inviteBody(await tokenOf(invite.id)));
    const updated = await pool.query<InviteRow>(
      "UPDATE invites SET status = 'sent', sent_at = now() WHERE id = $1 RETURNING *", [invite.id],
    );
    const row = updated.rows[0];
    events.invite(invite.team_id, inviteJson(row));
    return row;
  } catch {
    const updated = await pool.query<InviteRow>(
      "UPDATE invites SET status = 'held' WHERE id = $1 RETURNING *", [invite.id],
    );
    events.invite(invite.team_id, inviteJson(updated.rows[0]));
    return updated.rows[0];
  }
}

export async function tokenOf(inviteId: string): Promise<string> {
  const r = await pool.query<{ token: string }>('SELECT token FROM invites WHERE id = $1', [inviteId]);
  return r.rows[0].token;
}

export async function expireInvites(): Promise<void> {
  await pool.query(
    "UPDATE invites SET status = 'expired' WHERE status IN ('held','sent') AND created_at < now() - ($1 || ' milliseconds')::interval",
    [String(config.inviteTtlMs)],
  );
}

export async function retryHeld(): Promise<void> {
  await expireInvites();
  const held = await pool.query<InviteRow>("SELECT * FROM invites WHERE status = 'held'");
  for (const invite of held.rows) {
    const owner = await pool.query<{ name: string }>(
      'SELECT name FROM users WHERE team_id = $1 AND role = $2 LIMIT 1', [invite.team_id, 'owner'],
    );
    await trySend(invite, owner.rows[0]?.name ?? 'Owner');
  }
}

export function startRetryLoop(): void {
  const tick = () => {
    retryHeld().catch(() => undefined);
    setTimeout(tick, config.mailRetryMs);
  };
  setTimeout(tick, config.mailRetryMs);
}
