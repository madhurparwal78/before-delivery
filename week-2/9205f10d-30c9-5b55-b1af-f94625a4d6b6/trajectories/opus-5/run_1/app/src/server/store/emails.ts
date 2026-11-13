import type { Queryable } from '../db.js';
import { newId } from '../ids.js';
import type { QueuedEmail } from '../mail/templates.js';

export async function queueEmails(client: Queryable, emails: readonly QueuedEmail[]): Promise<void> {
  for (const email of emails) {
    await client.query(
      `INSERT INTO outgoing_emails (id, to_address, subject, body) VALUES ($1, $2, $3, $4)`,
      [newId('email'), email.to_address, email.subject, email.body],
    );
  }
}
