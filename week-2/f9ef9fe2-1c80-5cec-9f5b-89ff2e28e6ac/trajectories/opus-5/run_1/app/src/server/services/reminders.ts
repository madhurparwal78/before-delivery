import { DOCUMENT_LABELS, type DocumentType } from '../../shared/types.js';
import { pool, query } from '../db/pool.js';
import { EXPIRING_WINDOW_DAYS } from '../domain/cover.js';
import { loadKitchenOperatorEmail } from '../domain/kitchens.js';
import { addDays, kitchenToday } from '../domain/time.js';
import { withService } from './health.js';
import { sendExpiryReminder } from './mail.js';

/**
 * Within a minute of a verified document reading as expiring, its member and
 * the kitchen operator each get one reminder. Each document is reminded once.
 */
export async function sweepExpiryReminders(now: Date): Promise<void> {
  const kitchens = await query<{ id: string; timezone: string }>(
    pool,
    'SELECT id, timezone FROM kitchens',
  );
  for (const kitchen of kitchens) {
    const today = kitchenToday(kitchen.timezone, now);
    const due = await query<{
      id: string;
      type: DocumentType;
      expires_on: string;
      business: string;
      contact_email: string;
    }>(
      pool,
      `SELECT d.id, d.type, d.expires_on, m.business, m.contact_email
         FROM documents d
         JOIN members m ON m.id = d.member_id
        WHERE d.kitchen_id = $1 AND d.state = 'verified' AND d.expires_on IS NOT NULL
          AND d.expires_on >= $2::date AND d.expires_on <= $3::date
          AND NOT EXISTS (SELECT 1 FROM document_reminders r WHERE r.document_id = d.id)`,
      [kitchen.id, today, addDays(today, EXPIRING_WINDOW_DAYS)],
    );
    if (due.length === 0) continue;
    const operatorEmail = await loadKitchenOperatorEmail(pool, kitchen.id);
    for (const document of due) {
      const label = DOCUMENT_LABELS[document.type];
      try {
        await withService('mail', async () => {
          await sendExpiryReminder(
            document.contact_email,
            label,
            document.business,
            document.expires_on,
          );
          if (operatorEmail !== null) {
            await sendExpiryReminder(operatorEmail, label, document.business, document.expires_on);
          }
        });
        await pool.query(
          'INSERT INTO document_reminders (document_id, sent_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [document.id, now],
        );
      } catch {
        return;
      }
    }
  }
}

export function startExpiryReminders(): void {
  const run = (): void => {
    void sweepExpiryReminders(new Date()).catch(() => undefined);
  };
  run();
  setInterval(run, 20000).unref();
}
