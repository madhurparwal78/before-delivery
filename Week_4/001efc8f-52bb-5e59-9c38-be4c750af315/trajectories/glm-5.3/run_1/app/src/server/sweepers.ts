import type { AppServices } from './context';

/** The object-removal queue (DP-42): PostgreSQL-backed, retried every 30s. */
export async function sweepRemovalQueue(services: AppServices): Promise<void> {
  const rows = await services.db.pool.query<{ object_key: string; message_id: string }>(
    `SELECT object_key, message_id FROM removal_queue ORDER BY id LIMIT 500`,
  );
  if (rows.rowCount === 0) return;
  const keys = rows.rows.map((r) => r.object_key);
  let removed: string[] = [];
  try {
    await services.storage.removeMany(keys);
    removed = keys;
    services.storage.setAvailable(true);
  } catch {
    services.storage.setAvailable(false);
    return;
  }
  if (removed.length > 0) {
    await services.db.pool.query('DELETE FROM removal_queue WHERE object_key = ANY($1)', [removed]);
    const messageIds = [...new Set(rows.rows.map((r) => r.message_id))];
    for (const messageId of messageIds) {
      const left = await services.db.pool.query(
        `SELECT count(*)::int AS n FROM removal_queue WHERE message_id = $1`,
        [messageId],
      );
      if (left.rows[0].n === 0) {
        await services.db.pool.query(
          `UPDATE attachments SET state = 'removed' WHERE message_id = $1 AND state = 'removal_queued'`,
          [messageId],
        );
      }
    }
  }
}

/** Retries queued invite and digest emails. */
export async function sweepMailLedger(services: AppServices): Promise<void> {
  const rows = await services.db.pool.query<{ id: string; kind: string; key: string; payload: Record<string, unknown> }>(
    `SELECT id, kind, key, payload FROM mail_ledger WHERE state = 'pending' ORDER BY id LIMIT 200`,
  );
  if (rows.rowCount === 0) return;
  for (const row of rows.rows) {
    if (row.kind === 'invite') {
      const payload = row.payload as { email: string; name: string; workspaceName: string; inviteUrl: string; inviterName: string };
      const { buildInviteMail } = await import('./outbox');
      const built = buildInviteMail(services.config, payload);
      const ok = await services.outbox.attempt('invite', row.key, () => built);
      if (ok) await markHandledAfterMailAccepts(services, row.kind, row.key);
    }
    if (row.kind === 'digest') {
      const payload = row.payload as { email: string; name: string; subject: string; body: string };
      const ok = await services.outbox.attempt('digest', row.key, (when) => ({
        to: payload.email, toName: payload.name, subject: payload.subject, body: payload.body, date: when,
      }));
      if (ok) await markHandledAfterMailAccepts(services, row.kind, row.key);
    }
  }
}

/** When a queued email finally goes out, mark its period and mentions handled. */
async function markHandledAfterMailAccepts(services: AppServices, kind: string, key: string): Promise<void> {
  if (kind !== 'digest') return;
  const [userId, periodKey] = key.split(':');
  await services.outbox.markDigestSent(userId, periodKey);
  await services.db.pool.query(
    `UPDATE mentions SET digested_at = $3
       WHERE mentioned_user_id = $1 AND digested_at IS NULL AND id IN (
         SELECT mn.id FROM mentions mn
           JOIN messages m ON m.id = mn.message_id
          WHERE mn.mentioned_user_id = $1 AND m.deleted = false
            AND mn.digested_at IS NULL
            AND EXISTS (SELECT 1 FROM memberships ms WHERE ms.channel_id = mn.channel_id AND ms.user_id = $1)
            AND NOT EXISTS (
              SELECT 1 FROM messages r
               WHERE r.author_id = $1 AND r.deleted = false
                 AND r.sent_at > m.sent_at
                 AND (r.thread_root_id = m.thread_root_id
                      OR (m.thread_root_id IS NULL AND r.thread_root_id = m.id))))`,
    [userId, periodKey, services.clock.now()],
  );
}
