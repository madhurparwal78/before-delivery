import { rows, transaction } from '../db';
import { logFault } from '../log';
import { deliver } from '../services/mail';
import { FAILING_PROCESS_WAIT_MS, LEASE_SECONDS, PASS_LIMIT, RETRY_DELAY_SECONDS } from './schedule';

const cooldown = new Map<string, number>();

interface ClaimedNotice {
  id: string;
  to_email: string;
  subject: string;
  link: string;
  household_name: string;
}

async function claimNotice(): Promise<ClaimedNotice | null> {
  const blocked = [...cooldown.entries()].filter(([, until]) => until > Date.now()).map(([id]) => id);
  for (const [id, until] of cooldown) {
    if (until <= Date.now()) cooldown.delete(id);
  }
  return transaction(async (client) => {
    const found = await client.query(
      `SELECT n.id::text AS id, n.to_email, n.subject, n.link, h.name AS household_name
       FROM notices n JOIN households h ON h.id = n.household_id
       WHERE n.status = 'queued' AND n.next_attempt_at <= now()
         AND (n.lease_until IS NULL OR n.lease_until < now())
         AND NOT (n.id::text = ANY($1::text[]))
       ORDER BY n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`,
      [blocked],
    );
    const row = found.rows[0] as ClaimedNotice | undefined;
    if (!row) return null;
    await client.query("UPDATE notices SET lease_until = now() + make_interval(secs => $2) WHERE id = $1", [
      row.id,
      LEASE_SECONDS,
    ]);
    return row;
  });
}

async function recordMailHealth(noticeId: string, failed: boolean): Promise<void> {
  await rows(
    `INSERT INTO mail_health (household_id, last_attempt_failed)
     SELECT household_id, $2 FROM notices WHERE id = $1
     ON CONFLICT (household_id) DO UPDATE SET last_attempt_failed = EXCLUDED.last_attempt_failed`,
    [noticeId, failed],
  );
}

/** The notice relay: hands each queued notice to SMTP, then marks it sent. */
export async function runRelayOnce(): Promise<void> {
  for (let handled = 0; handled < PASS_LIMIT; handled += 1) {
    const claimed = await claimNotice();
    if (!claimed) return;
    try {
      await deliver({
        noticeId: claimed.id,
        to: claimed.to_email,
        subject: claimed.subject,
        householdName: claimed.household_name,
        link: claimed.link,
      });
    } catch (error) {
      logFault('notice hand-off', error);
      cooldown.set(claimed.id, Date.now() + FAILING_PROCESS_WAIT_MS);
      await rows(
        `UPDATE notices SET attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => $2),
            lease_until = null
         WHERE id = $1`,
        [claimed.id, RETRY_DELAY_SECONDS],
      );
      await recordMailHealth(claimed.id, true);
      return;
    }
    await rows(
      `UPDATE notices SET status = 'sent', sent_at = now(), attempts = attempts + 1, lease_until = null
       WHERE id = $1 AND status = 'queued'`,
      [claimed.id],
    );
    await recordMailHealth(claimed.id, false);
  }
}
