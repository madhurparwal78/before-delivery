import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { publishBoardChange } from '../board/events.js';
import { inviteMail } from './mailContent.js';
import { MailUnavailable, sendMail } from './smtp.js';

/** A lease left behind by a stopped instance lapses 30 seconds after it was taken. */
export const LEASE_SECONDS = 30;

interface ClaimedInvite {
  id: string;
  workshop_id: string;
  email: string;
  title: string;
  scheduled_start: string;
  scheduled_end: string;
  time_zone: string;
  token: string | null;
}

/**
 * Claims queued invites under a Postgres lease, so no two instances work on the same invite.
 * A queued invite waits while no link is active, then carries the next active link.
 */
async function claimQueuedInvites(workshopId: string | null): Promise<ClaimedInvite[]> {
  const result = await pool.query<ClaimedInvite>(
    `WITH claimed AS (
       SELECT i.id FROM invites i
        WHERE i.status = 'queued'
          AND (i.lease_until IS NULL OR i.lease_until < now())
          AND ($1::text IS NULL OR i.workshop_id = $1::text)
          AND EXISTS (SELECT 1 FROM join_links jl WHERE jl.workshop_id = i.workshop_id AND jl.revoked_at IS NULL)
        ORDER BY i.created_seq
        LIMIT 50
        FOR UPDATE SKIP LOCKED
     )
     UPDATE invites i
        SET lease_until = now() + ($2 || ' seconds')::interval, attempts = i.attempts + 1
       WHERE i.id IN (SELECT id FROM claimed)
     RETURNING i.id, i.workshop_id, i.email,
       (SELECT w.title FROM workshops w WHERE w.id = i.workshop_id) AS title,
       (SELECT w.scheduled_start FROM workshops w WHERE w.id = i.workshop_id) AS scheduled_start,
       (SELECT w.scheduled_end FROM workshops w WHERE w.id = i.workshop_id) AS scheduled_end,
       (SELECT f.time_zone FROM workshops w JOIN facilitators f ON f.id = w.facilitator_id
         WHERE w.id = i.workshop_id) AS time_zone,
       (SELECT jl.token FROM join_links jl WHERE jl.workshop_id = i.workshop_id AND jl.revoked_at IS NULL) AS token`,
    [workshopId, String(LEASE_SECONDS)],
  );
  return result.rows;
}

async function releaseInvite(inviteId: string): Promise<void> {
  await pool.query('UPDATE invites SET lease_until = NULL WHERE id = $1', [inviteId]);
}

async function markInviteSent(inviteId: string, workshopId: string): Promise<void> {
  await pool.query(
    `UPDATE invites SET status = 'sent', sent_at = now(), lease_until = NULL WHERE id = $1`,
    [inviteId],
  );
  const bumped = await pool.query<{ version: number }>(
    'UPDATE workshops SET version = version + 1 WHERE id = $1 RETURNING version',
    [workshopId],
  );
  const version = bumped.rows[0]?.version;
  if (version !== undefined) await publishBoardChange(pool, { workshopId, version });
}

/**
 * Attempts delivery of queued invites. Each address gets at most one invite per add, because
 * only a row still marked queued is claimed and it is marked sent in the same pass.
 */
export async function deliverQueuedInvites(workshopId: string | null): Promise<void> {
  const claimed = await claimQueuedInvites(workshopId);
  for (const invite of claimed) {
    if (invite.token === null) {
      await releaseInvite(invite.id);
      continue;
    }
    try {
      await sendMail(
        inviteMail({
          to: invite.email,
          title: invite.title,
          joinUrl: `${config.publicBaseUrl}/join/${invite.token}`,
          scheduledStart: invite.scheduled_start,
          scheduledEnd: invite.scheduled_end,
          timeZone: invite.time_zone,
        }),
      );
    } catch (error) {
      if (error instanceof MailUnavailable) {
        // The invite stays queued and delivery keeps being retried.
        await releaseInvite(invite.id);
        continue;
      }
      await releaseInvite(invite.id);
      throw error;
    }
    await markInviteSent(invite.id, invite.workshop_id);
  }
}
