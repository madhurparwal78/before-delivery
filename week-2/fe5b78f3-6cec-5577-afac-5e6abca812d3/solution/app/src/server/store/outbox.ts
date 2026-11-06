// The mail outbox: written in the same change as its event, sent from there by the outbox worker.
import type { Db } from "./rows.js";

interface QueuedMail {
  to: string;
  subject: string;
  text: string;
  attach?: { pnr: string; version: number };
}

export async function queueMail(db: Db, mail: QueuedMail): Promise<void> {
  await db.query("INSERT INTO outbox (to_address, subject, body, attach_pnr, attach_version) VALUES ($1, $2, $3, $4, $5)", [
    mail.to, mail.subject, mail.text, mail.attach?.pnr ?? null, mail.attach?.version ?? null,
  ]);
}
