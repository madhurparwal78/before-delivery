import { pool, query, tx } from "../db/pool.ts";
import { clientMail } from "../domain/clientMail.ts";
import type { Language } from "../domain/towns.ts";
import { deliver, queueMail } from "../providers/mail.ts";
import { every2s } from "./loop.ts";

interface DueReminder {
  token: string;
  address: string;
  language: Language;
  client_id: string;
  client_name: string;
  email: string;
  title: string;
  due_date: string;
}

/** One reminder, only with no answer or sign-off on a live page; a client in its wait gets it after a bring-back. */
async function queueReminders(): Promise<void> {
  const due = await query<DueReminder>(
    `SELECT cp.token, cp.address, cp.language, c.id AS client_id, c.name AS client_name, c.email, p.title, p.due_date
     FROM client_pages cp JOIN pieces p ON p.id = cp.piece_id JOIN clients c ON c.id = p.client_id
     WHERE cp.reminder_at <= now() AND cp.reminded_at IS NULL AND cp.ended_at IS NULL AND cp.ends_at > now()
       AND cp.answered_at IS NULL AND cp.signed_at IS NULL AND c.state = 'active' AND c.email IS NOT NULL`,
  );
  for (const page of due) {
    await tx(async (client) => {
      await client.query("UPDATE client_pages SET reminded_at = now() WHERE token = $1", [page.token]);
      const mail = clientMail("M2", { language: page.language, clientName: page.client_name, title: page.title, address: page.address, dueDate: page.due_date });
      await queueMail({ clientId: page.client_id, to: page.email, ...mail }, client);
    });
  }
}

interface QueuedMail {
  id: bigint;
  to_address: string;
  reply_to: string | null;
  subject: string;
  body: string;
}

async function deliverOutbox(): Promise<void> {
  await pool.query(
    `DELETE FROM mail_outbox o USING clients c WHERE o.client_id = c.id AND o.sent_at IS NULL AND c.state IN ('erasing', 'erased')`,
  );
  const queued = await query<QueuedMail>("SELECT id, to_address, reply_to, subject, body FROM mail_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 50");
  for (const mail of queued) {
    await deliver({ to: mail.to_address, replyTo: mail.reply_to, subject: mail.subject, body: mail.body });
    await query("UPDATE mail_outbox SET sent_at = now() WHERE id = $1", [mail.id]);
  }
}

export function startMailJob(): void {
  every2s("mail", async () => {
    await queueReminders();
    await deliverOutbox();
  });
}
