// Sends queued emails, each exactly once even when several instances share the database.
import { transaction } from "./db.js";
import { lockNextEmail, markEmailSent } from "./emails.js";
import { sendMail } from "./smtp.js";

/** Delivery is retried on the next tick until the SMTP server accepts the message. */
export async function sendQueuedEmails(): Promise<void> {
  for (;;) {
    const sent = await transaction(async (client) => {
      const next = await lockNextEmail(client);
      if (next === undefined) return false;
      await sendMail(next);
      await markEmailSent(client, next.id);
      return true;
    });
    if (!sent) return;
  }
}
