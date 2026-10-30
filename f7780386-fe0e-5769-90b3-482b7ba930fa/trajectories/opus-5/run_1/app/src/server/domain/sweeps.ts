import { addDays } from '../../shared/time.js';
import { seededDocuments } from '../db/seed.js';
import type { AppContext } from '../http/context.js';
import { MailUnavailable } from '../services/mailer.js';
import { renderTextPdf } from '../services/pdf.js';
import { StorageUnavailable } from '../services/storage.js';
import { completeDueBookings } from './bookings.js';
import { drainBillingQueue } from './billing.js';
import { enqueueEmail, expiryWarningEmail } from './emails.js';
import { markHoldsExpired } from './holds.js';
import type { Queryable } from './kitchen.js';

interface WarnableDocument {
  id: string;
  kind: string;
  crew_cook_name: string | null;
  expires_on: string;
  contact_email: string;
  warned_14: boolean;
  warned_3: boolean;
}

/**
 * One 14-day warning and one 3-day warning per approved document, judged on
 * the kitchen's today. Neither is ever sent twice.
 */
export async function sendExpiryWarnings(
  db: Queryable,
  today: string,
  now: Date,
): Promise<void> {
  const candidates = await db.query<WarnableDocument>(
    `SELECT d.id, d.kind, u.name AS crew_cook_name, d.expires_on, m.contact_email,
            d.warned_14, d.warned_3
       FROM documents d
       JOIN members m ON m.id = d.member_id
       LEFT JOIN users u ON u.id = d.crew_cook_id
      WHERE d.status = 'approved' AND (d.warned_14 = false OR d.warned_3 = false)`,
  );

  for (const document of candidates.rows) {
    const fourteen = addDays(document.expires_on, -14);
    const three = addDays(document.expires_on, -3);

    if (!document.warned_3 && today >= three && today <= document.expires_on) {
      const mail = expiryWarningEmail({
        documentId: document.id,
        kind: document.kind,
        crewCookName: document.crew_cook_name,
        expiresOn: document.expires_on,
        days: 3,
      });
      await enqueueEmail(db, mail.dedupeKey, document.contact_email, mail.subject, mail.body, now);
      await db.query('UPDATE documents SET warned_3 = true WHERE id = $1', [document.id]);
    } else if (!document.warned_14 && today >= fourteen && today < three) {
      const mail = expiryWarningEmail({
        documentId: document.id,
        kind: document.kind,
        crewCookName: document.crew_cook_name,
        expiresOn: document.expires_on,
        days: 14,
      });
      await enqueueEmail(db, mail.dedupeKey, document.contact_email, mail.subject, mail.body, now);
      await db.query('UPDATE documents SET warned_14 = true WHERE id = $1', [document.id]);
    }
  }
}

/** Sends queued mail. A claim makes a second sweep skip a message in flight. */
async function drainEmailOutbox(app: AppContext, now: Date): Promise<void> {
  const queued = await app.db.query<{ id: string }>(
    `SELECT id::text FROM email_outbox WHERE status = 'queued' ORDER BY id LIMIT 50`,
  );
  for (const { id } of queued.rows) {
    const claimed = await app.db.query<{
      to_address: string;
      subject: string;
      body: string;
    }>(
      `UPDATE email_outbox SET status = 'sending' WHERE id = $1 AND status = 'queued'
       RETURNING to_address, subject, body`,
      [id],
    );
    const message = claimed.rows[0];
    if (message === undefined) continue;
    try {
      await app.mailer.send(
        { to: message.to_address, subject: message.subject, body: message.body },
        now,
      );
      await app.db.query(`UPDATE email_outbox SET status = 'sent', sent_at = $2 WHERE id = $1`, [
        id,
        now,
      ]);
    } catch (error) {
      await app.db.query(`UPDATE email_outbox SET status = 'queued' WHERE id = $1`, [id]);
      if (error instanceof MailUnavailable) return;
      throw error;
    }
  }
}

let seedObjectsWritten = false;

/** Seeded documents each get a one-page PDF object, written once storage returns. */
async function ensureSeedObjects(app: AppContext): Promise<void> {
  if (seedObjectsWritten) return;
  for (const document of seededDocuments()) {
    if (await app.storage.objectExists(document.storage_key)) continue;
    const pdf = renderTextPdf([
      { text: 'Halsted Street Kitchen', size: 18, bold: true, gap: 6 },
      { text: 'Certificate on file', size: 13, bold: true },
      { text: document.label, size: 11 },
      { text: `Document ${document.id}`, size: 10 },
    ]);
    await app.storage.putObject(document.storage_key, pdf, 'application/pdf');
    await app.db.query('UPDATE documents SET size_bytes = $2 WHERE id = $1 AND size_bytes = 0', [
      document.id,
      pdf.byteLength,
    ]);
  }
  seedObjectsWritten = true;
}

let ticking = false;

/**
 * The background loop. Every dependency is retried here, so work queued during
 * an outage settles without a restart.
 */
export async function runSweep(app: AppContext): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    if (!(await app.db.ensureReady())) return;
    const now = app.clock.now();
    const today = app.clock.today();

    await markHoldsExpired(app.db, now);
    await completeDueBookings(app.db, now);
    await sendExpiryWarnings(app.db, today, now);

    if ((await app.billing.probe()) === 'up') {
      await drainBillingQueue(app, now);
    }

    await drainEmailOutbox(app, now);

    try {
      await ensureSeedObjects(app);
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
    }
  } finally {
    ticking = false;
  }
}
