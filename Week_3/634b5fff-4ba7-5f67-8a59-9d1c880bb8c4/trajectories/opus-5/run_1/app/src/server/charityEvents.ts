import { query } from './db.js';
import { sendCharityEvent, type CharityEventType } from './services/webhooks.js';

/**
 * Charity events are kept in Postgres first, so a webhook-service outage holds
 * them rather than losing them.
 */
export async function keepCharityEvent(
  eventId: string,
  eventType: CharityEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await query(
    `INSERT INTO pending_webhooks (event_id, event_type, payload) VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType, JSON.stringify(payload)],
  );
}

export async function flushCharityEvent(eventId: string): Promise<void> {
  const rows = await query<{ event_type: CharityEventType; payload: Record<string, unknown> }>(
    'SELECT event_type, payload FROM pending_webhooks WHERE event_id = $1 AND sent_at IS NULL',
    [eventId],
  );
  const row = rows[0];
  if (row === undefined) return;
  await sendCharityEvent(row.event_type, eventId, row.payload);
  await query('UPDATE pending_webhooks SET sent_at = now() WHERE event_id = $1', [eventId]);
}

export async function flushKeptCharityEvents(): Promise<void> {
  const rows = await query<{ event_id: string }>(
    'SELECT event_id FROM pending_webhooks WHERE sent_at IS NULL ORDER BY created_at LIMIT 50',
  );
  for (const row of rows) {
    try {
      await flushCharityEvent(row.event_id);
    } catch {
      return;
    }
  }
}
