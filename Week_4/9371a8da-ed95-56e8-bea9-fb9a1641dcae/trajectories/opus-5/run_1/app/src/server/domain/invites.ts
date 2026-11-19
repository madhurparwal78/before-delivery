import { config } from '../config.js';
import { Tx } from '../db.js';
import { ApiError } from '../http/errors.js';
import { Invite, iso } from './shapes.js';

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InviteRow {
  id: string;
  project_id: string;
  token: string;
  email: string;
  email_lower: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked';
  sent_at: Date;
  expires_at: Date;
  inviter_id: string;
  inviter_name: string;
}

/** The invite state machine, evaluated on the server's UTC clock. */
export function inviteStatus(row: InviteRow, now: Date = new Date()): InviteStatus {
  if (row.status !== 'pending') return row.status;
  return now.getTime() >= row.expires_at.getTime() ? 'expired' : 'pending';
}

export function inviteShape(row: InviteRow, now: Date = new Date()): Invite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: inviteStatus(row, now),
    sentAt: iso(row.sent_at),
    expiresAt: iso(row.expires_at),
  };
}

/**
 * The hourly allowance: at most 10 invitations recorded on one project inside
 * the configured window, counting every status.
 */
export async function checkHourlyAllowance(tx: Tx, projectId: string): Promise<void> {
  const windowSeconds = config.inviteWindowSeconds;
  const rows = await tx.query<{ sent_at: Date }>(
    `select sent_at from invites
      where project_id = $1 and sent_at > now() - make_interval(secs => $2)
      order by sent_at asc`,
    [projectId, windowSeconds],
  );
  if (rows.length < 10) return;
  const oldest = rows[0].sent_at.getTime();
  const freeAt = oldest + windowSeconds * 1000;
  const seconds = Math.max(1, Math.ceil((freeAt - Date.now()) / 1000));
  throw new ApiError(
    429,
    'rate_limited',
    { retryAfterSeconds: seconds },
    { 'Retry-After': String(seconds) },
  );
}
