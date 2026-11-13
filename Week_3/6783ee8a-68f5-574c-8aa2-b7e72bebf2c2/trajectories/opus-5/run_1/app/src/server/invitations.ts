import { query, queryOne } from './db.js';
import { scheduleSearchSync } from './notebookstore.js';

export interface InvitationRow {
  id: string;
  notebook_id: string;
  email: string;
  email_lower: string;
  role: 'editor' | 'viewer';
  status: 'invited' | 'active';
  notebook_title: string;
  owner_display_name: string;
}

export async function invitationByToken(token: string): Promise<InvitationRow | null> {
  return queryOne<InvitationRow>(
    `select s.id, s.notebook_id, s.email, s.email_lower, s.role, s.status,
            n.title as notebook_title, u.display_name as owner_display_name
       from shares s
       join notebooks n on n.id = s.notebook_id
       join users u on u.id = n.owner_id
      where s.token = $1`,
    [token],
  );
}

/**
 * Turns an invitation into access for the invited account. An invitation grants
 * access only when the invited account opens its link.
 */
export async function acceptInvitation(invitation: InvitationRow, userId: string): Promise<void> {
  await query(
    `update shares set status = 'active', user_id = $1 where id = $2`,
    [userId, invitation.id],
  );
  scheduleSearchSync(invitation.notebook_id);
}
