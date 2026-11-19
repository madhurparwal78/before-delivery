import { query } from '../db';
import { nowDate } from '../clock';
import { deliverMail } from './mail';
import { noteMail } from './health';

export interface QueuedMail {
  dedupeKey: string;
  toAddress: string;
  toName: string;
  subject: string;
  body: string;
}

/** Email bookkeeping: every invite is stored, then handed to mail once. */
export async function enqueueMail(mail: QueuedMail): Promise<void> {
  await query(
    `INSERT INTO outbound_emails (dedupe_key, to_address, to_name, subject, body, state, created_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [mail.dedupeKey, mail.toAddress, mail.toName, mail.subject, mail.body, nowDate()],
  );
}

async function deliverQueued(row: {
  dedupe_key: string;
  to_address: string;
  to_name: string;
  subject: string;
  body: string;
}): Promise<boolean> {
  const claimed = await query<{ dedupe_key: string }>(
    "UPDATE outbound_emails SET state = 'sending' WHERE dedupe_key = $1 AND state = 'queued' RETURNING dedupe_key",
    [row.dedupe_key],
  );
  if (claimed.length === 0) return false;
  try {
    await deliverMail({ toAddress: row.to_address, toName: row.to_name, subject: row.subject, body: row.body });
    await query("UPDATE outbound_emails SET state = 'sent', sent_at = $2 WHERE dedupe_key = $1", [
      row.dedupe_key,
      nowDate(),
    ]);
    noteMail(true);
    return true;
  } catch {
    await query("UPDATE outbound_emails SET state = 'queued' WHERE dedupe_key = $1", [row.dedupe_key]);
    noteMail(false);
    return false;
  }
}

export async function sendNow(mail: QueuedMail): Promise<boolean> {
  await enqueueMail(mail);
  return deliverQueued({
    dedupe_key: mail.dedupeKey,
    to_address: mail.toAddress,
    to_name: mail.toName,
    subject: mail.subject,
    body: mail.body,
  });
}

export async function flushOutbox(): Promise<void> {
  const rows = await query<{
    dedupe_key: string;
    to_address: string;
    to_name: string;
    subject: string;
    body: string;
  }>(
    `SELECT dedupe_key, to_address, to_name, subject, body FROM outbound_emails
     WHERE state = 'queued' ORDER BY created_at ASC LIMIT 50`,
  );
  for (const row of rows) {
    const sent = await deliverQueued(row);
    if (!sent) return;
  }
}
