import { pool } from "./db";
import { addDays, kitchenDate } from "./kitchenTime";
import { reminderEmail } from "./emails";
import { makeSeedDocumentPdf } from "./services/storageSeedPdf";
import type { MailService } from "./services/mail";
import type { ObjectStorage } from "./services/storage";

/**
 * Background work: storing seeded document PDFs once storage is reachable, and
 * sending the expiry reminder for documents that read as expiring.
 */
export function startBackgroundWork(storage: ObjectStorage, mail: MailService): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    try {
      await storeSeededDocuments(storage);
      await sendReminders(mail);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, 30000);
  timer.unref();
}

async function storeSeededDocuments(storage: ObjectStorage): Promise<void> {
  const pending = await pool.query(
    `SELECT d.id, d.kitchen_id, d.member_id FROM documents d WHERE d.storage_key IS NULL`
  );
  if (pending.rows.length === 0) {
    return;
  }
  const pdf = makeSeedDocumentPdf();
  for (const row of pending.rows) {
    const key = `documents/${row.kitchen_id}/${row.member_id}/${row.id}`;
    try {
      await storage.put(key, pdf, "application/pdf");
      await pool.query("UPDATE documents SET storage_key = $1 WHERE id = $2", [key, row.id]);
    } catch {
      return; // storage still down; try again next tick
    }
  }
}

async function sendReminders(mail: MailService): Promise<void> {
  const kitchens = await pool.query("SELECT id, timezone FROM kitchens");
  for (const kitchen of kitchens.rows) {
    const today = kitchenDate(new Date(), kitchen.timezone);
    const docs = await pool.query(
      `SELECT d.id, d.member_id, d.type, d.expires_on::text AS expires_on, m.business, m.contact_email
       FROM documents d JOIN members m ON m.id = d.member_id
       WHERE d.kitchen_id = $1 AND d.state = 'verified' AND d.expires_on IS NOT NULL
         AND d.expires_on >= $2 AND d.expires_on <= $3 AND d.reminded_at IS NULL`,
      [kitchen.id, today, addDays(today, 14)]
    );
    if (docs.rows.length === 0) {
      continue;
    }
    const operator = await pool.query("SELECT email FROM users WHERE kitchen_id = $1 AND role = 'operator' LIMIT 1", [kitchen.id]);
    const operatorEmail = operator.rows[0]?.email as string | undefined;
    const labels: Record<string, string> = {
      insurance: "Insurance certificate",
      food_handler: "Food-handler card",
    };
    for (const doc of docs.rows) {
      const label = labels[doc.type as string] ?? (doc.type as string);
      const message = reminderEmail(doc.contact_email as string, label, doc.business as string, doc.expires_on as string);
      try {
        await mail.send(message.to, message.subject, message.body);
        if (operatorEmail) {
          await mail.send(operatorEmail, message.subject, message.body);
        }
        await pool.query("UPDATE documents SET reminded_at = now() WHERE id = $1", [doc.id]);
      } catch {
        return; // mail down; try again next tick
      }
    }
  }
}
