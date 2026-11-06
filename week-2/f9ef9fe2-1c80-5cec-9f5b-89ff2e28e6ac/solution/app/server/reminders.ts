import { pool, transaction } from "./db.js";
import type { DocumentRow, Kitchen } from "./domain.js";
import { reminderEmail } from "./emails.js";
import { kitchenDate } from "./kitchenTime.js";
import { send } from "./mail.js";
import { documentState } from "./rules.js";
import { isUp } from "./services.js";

// Expiry reminders: once a verified document reads as expiring, its member and the kitchen operator
// each get one email. The reminder row is claimed in the same transaction that sends, so several
// app processes on one database never send twice and a refused send is retried later.

let running = false;

export async function scanReminders(now = new Date()): Promise<void> {
  if (running || !isUp("mail")) return;
  running = true;
  try {
    const kitchens = (await pool.query<Kitchen>("SELECT id, name, timezone, same_day_cutoff FROM kitchens")).rows;
    for (const kitchen of kitchens) {
      const today = kitchenDate(kitchen.timezone, now);
      const docs = await pool.query<Pick<DocumentRow, "id" | "type" | "state" | "expires_on"> & { business: string; contact_email: string }>(
        `SELECT d.id, d.type, d.state, d.expires_on, m.business, m.contact_email
           FROM documents d JOIN members m ON m.id = d.member_id
          WHERE d.kitchen_id = $1 AND d.state = 'verified' AND d.expires_on IS NOT NULL`,
        [kitchen.id],
      );
      const operators = (await pool.query<{ email: string }>("SELECT email FROM users WHERE kitchen_id = $1 AND role = 'operator'", [kitchen.id]))
        .rows.map((u) => u.email);
      for (const doc of docs.rows) {
        const expiresOn = doc.expires_on;
        if (expiresOn === null || documentState(doc, today) !== "expiring") continue;
        for (const recipient of [doc.contact_email, ...operators]) {
          await transaction(async (client) => {
            const claimed = await client.query(
              "INSERT INTO reminders (document_id, recipient, sent_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [doc.id, recipient, now],
            );
            if (claimed.rowCount === 1) await send(reminderEmail(recipient, doc.business, doc.type, expiresOn, kitchen));
          });
        }
      }
    }
  } catch (error) {
    console.error(`Reminder scan stopped: ${error instanceof Error ? error.name : "error"}`);
  } finally {
    running = false;
  }
}

export function watchReminders(): void {
  void scanReminders();
  setInterval(() => void scanReminders(), 20_000).unref();
}
