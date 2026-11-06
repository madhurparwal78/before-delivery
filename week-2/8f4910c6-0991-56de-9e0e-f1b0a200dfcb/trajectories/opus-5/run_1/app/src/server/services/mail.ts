import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, type Tx } from '../db.js';
import { newId } from '../ids.js';
import { sendMessage } from './smtp.js';

export type OutboundMail = {
  recipient: string;
  subject: string;
  body: string;
  attachment?: { name: string; content: string };
  talentIds?: string[];
  /** Keeps an effect to one message however many copies run. */
  dedupeKey?: string;
};

/** Header values never carry line breaks, whatever a public form contained. */
function headerValue(value: string): string {
  const single = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(single)) return single;
  return `=?UTF-8?B?${Buffer.from(single, 'utf8').toString('base64')}?=`;
}

function buildMessage(mail: OutboundMail): string {
  const boundary = `rungboard-${randomUUID()}`;
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${headerValue(mail.recipient)}`,
    `Subject: ${headerValue(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@rungboard.vesperrowe.example>`,
    'MIME-Version: 1.0',
  ];
  const text = mail.body.replace(/\r?\n/g, '\r\n');
  if (!mail.attachment) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit');
    return `${headers.join('\r\n')}\r\n\r\n${text}`;
  }
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const attachment = Buffer.from(mail.attachment.content, 'utf8').toString('base64');
  const wrapped = attachment.replace(/(.{76})/g, '$1\r\n');
  return [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    `--${boundary}`,
    `Content-Type: text/calendar; charset=utf-8; name="${mail.attachment.name}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${mail.attachment.name}"`,
    '',
    wrapped,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Every email leaves through the PostgreSQL outbox. */
export async function queueMail(mail: OutboundMail, tx?: Tx): Promise<void> {
  const run = tx ? tx.query.bind(tx) : query;
  await run(
    `INSERT INTO outbox (id, dedupe_key, recipient, subject, body, attachment_name, attachment_body, talent_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      newId('mail'),
      mail.dedupeKey ?? null,
      mail.recipient,
      mail.subject,
      mail.body,
      mail.attachment?.name ?? null,
      mail.attachment?.content ?? null,
      mail.talentIds ?? [],
    ],
  );
}

type OutboxRow = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  attachment_name: string | null;
  attachment_body: string | null;
};

function fromAddress(): string {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match ? match[1] : config.mail.from;
}

/** Any copy may deliver; a claimed message is delivered exactly once. */
export async function deliverPending(nowMs: number): Promise<void> {
  const claimed = await query<OutboxRow>(
    `UPDATE outbox SET claimed_at = $1, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM outbox
       WHERE sent_at IS NULL AND next_attempt_at <= $1
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 20
     )
     RETURNING id, recipient, subject, body, attachment_name, attachment_body`,
    [new Date(nowMs)],
  );
  for (const row of claimed) {
    const mail: OutboundMail = {
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      ...(row.attachment_name && row.attachment_body
        ? { attachment: { name: row.attachment_name, content: row.attachment_body } }
        : {}),
    };
    try {
      await sendMessage(fromAddress(), row.recipient, buildMessage(mail));
      await query('UPDATE outbox SET sent_at = $2 WHERE id = $1', [row.id, new Date(nowMs)]);
    } catch {
      await query('UPDATE outbox SET next_attempt_at = $2 WHERE id = $1', [
        row.id,
        new Date(nowMs + 5_000),
      ]);
    }
  }
}
