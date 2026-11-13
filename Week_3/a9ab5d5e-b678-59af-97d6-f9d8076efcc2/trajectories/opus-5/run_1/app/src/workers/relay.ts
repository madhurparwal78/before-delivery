import { rows, transaction } from '../db';
import { deliver } from '../services/mail';

const cooldown = new Map<string, number>();

/** The notice relay: hands each queued notice to SMTP, then marks it sent. */
export async function runRelayOnce(): Promise<void> {
  const blocked = [...cooldown.entries()].filter(([, until]) => until > Date.now()).map(([id]) => id);
  for (const [id, until] of cooldown) {
    if (until <= Date.now()) cooldown.delete(id);
  }
  const claimed = await transaction(async (client) => {
    const found = await client.query(
      `SELECT n.id::text AS id, n.to_email, n.subject, n.link, h.name AS household_name
       FROM notices n JOIN households h ON h.id = n.household_id
       WHERE n.status = 'queued' AND n.next_attempt_at <= now()
         AND (n.lease_until IS NULL OR n.lease_until < now())
         AND NOT (n.id::text = ANY($1::text[]))
       ORDER BY n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`,
      [blocked],
    );
    const row = found.rows[0] as
      | { id: string; to_email: string; subject: string; link: string; household_name: string }
      | undefined;
    if (!row) return null;
    await client.query("UPDATE notices SET lease_until = now() + interval '30 seconds' WHERE id = $1", [row.id]);
    return row;
  });
  if (!claimed) return;
  try {
    await deliver({
      noticeId: claimed.id,
      to: claimed.to_email,
      subject: claimed.subject,
      householdName: claimed.household_name,
      link: claimed.link,
    });
    await rows(
      `UPDATE notices SET status = 'sent', sent_at = now(), attempts = attempts + 1, lease_until = null
       WHERE id = $1 AND status = 'queued'`,
      [claimed.id],
    );
    await rows(
      `INSERT INTO mail_health (household_id, last_attempt_failed)
       SELECT household_id, false FROM notices WHERE id = $1
       ON CONFLICT (household_id) DO UPDATE SET last_attempt_failed = false`,
      [claimed.id],
    );
  } catch {
    cooldown.set(claimed.id, Date.now() + 6000);
    await rows(
      `UPDATE notices SET attempts = attempts + 1, next_attempt_at = now() + interval '2 seconds', lease_until = null
       WHERE id = $1`,
      [claimed.id],
    );
    await rows(
      `INSERT INTO mail_health (household_id, last_attempt_failed)
       SELECT household_id, true FROM notices WHERE id = $1
       ON CONFLICT (household_id) DO UPDATE SET last_attempt_failed = true`,
      [claimed.id],
    );
  }
}
