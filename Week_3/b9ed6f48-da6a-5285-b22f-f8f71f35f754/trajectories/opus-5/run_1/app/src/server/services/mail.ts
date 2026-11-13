import { config } from '../config.js';
import { pool, query } from '../db/index.js';
import { formatPrice, type Currency } from '../../shared/money.js';
import type { TierName } from '../../shared/copy.js';
import { receiptLines, type ReceiptFacts } from '../domain/receipts.js';
import { deliver, type OutboundMessage } from './smtp.js';

const accountLink = (): string => `${config.publicUrl}/account`;
const studioLink = (): string => `${config.publicUrl}/studio`;

function receiptBody(facts: ReceiptFacts, extraLines: string[] = []): string {
  return receiptLines(facts, extraLines).join('\n');
}

export interface TicketFacts extends ReceiptFacts {
  sessionTitle: string;
  startsAtDisplay: string;
  ticketCode: string;
  seats: number;
}

export function ticketMessage(facts: TicketFacts): OutboundMessage {
  return {
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    subject: `Your ticket for ${facts.sessionTitle} — receipt ${facts.receiptNumber}`,
    body: receiptBody(facts, [
      `Ticket ${facts.ticketCode}`,
      `${facts.seats} ${facts.seats === 1 ? 'seat' : 'seats'}`,
      facts.startsAtDisplay,
    ]),
  };
}

export function donationMessage(facts: ReceiptFacts): OutboundMessage {
  return {
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    subject: `Thank you for your donation — receipt ${facts.receiptNumber}`,
    body: receiptBody(facts),
  };
}

export function joinMessage(facts: ReceiptFacts, tierName: TierName): OutboundMessage {
  return {
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    subject: `Welcome, ${tierName} supporter — receipt ${facts.receiptNumber}`,
    body: receiptBody(facts),
  };
}

export function upgradeMessage(facts: ReceiptFacts): OutboundMessage {
  return {
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    subject: `Your supporter upgrade — receipt ${facts.receiptNumber}`,
    body: receiptBody(facts),
  };
}

export function refundMessage(facts: ReceiptFacts): OutboundMessage {
  return {
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    subject: `Your refund — receipt ${facts.receiptNumber}`,
    body: receiptBody(facts),
  };
}

export function sessionCancelledMessage(
  facts: ReceiptFacts & { sessionTitle: string; startsAtDisplay: string },
): OutboundMessage {
  return {
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    subject: `Cancelled: ${facts.sessionTitle} — full refund issued`,
    body: receiptBody(facts, [facts.startsAtDisplay]),
  };
}

export interface DunningFacts {
  recipientName: string;
  recipientEmail: string;
  tierName: TierName;
  amountMinor: number;
  currency: Currency;
}

function dunningBody(facts: DunningFacts, lead: string): string {
  return [
    facts.recipientName,
    '',
    lead,
    `${facts.tierName} supporter plan`,
    `${formatPrice(facts.amountMinor, facts.currency)} ${facts.currency}`,
    '',
    accountLink(),
  ].join('\n');
}

export function dunningFirstMessage(facts: DunningFacts): OutboundMessage {
  return {
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    subject: "Your supporter payment didn't go through",
    body: dunningBody(facts, 'Your card was declined, so this payment is still due.'),
  };
}

export function dunningReminderMessage(facts: DunningFacts): OutboundMessage {
  return {
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    subject: 'Reminder: your supporter payment is still due',
    body: dunningBody(facts, 'We tried your card on file again and it was declined.'),
  };
}

export function dunningCancelledMessage(facts: DunningFacts): OutboundMessage {
  return {
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    subject: 'Your supporter membership has been cancelled',
    body: dunningBody(facts, 'After three further attempts this payment is still unpaid, so your membership has ended.'),
  };
}

export function reviewNoticeMessage(input: {
  recipientEmail: string;
  recipientName: string;
  itemTitle: string;
}): OutboundMessage {
  return {
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    subject: `For review: ${input.itemTitle}`,
    body: [input.recipientName, '', `${input.itemTitle} is waiting for review.`, '', studioLink()].join('\n'),
  };
}

export function withdrawalNoticeMessage(input: {
  recipientEmail: string;
  recipientName: string;
  itemTitle: string;
  reason: string;
}): OutboundMessage {
  return {
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    subject: `Withdrawn: ${input.itemTitle}`,
    body: [
      input.recipientName,
      '',
      `${input.itemTitle} has been withdrawn.`,
      `Reason: ${input.reason}`,
      '',
      studioLink(),
    ].join('\n'),
  };
}

/* ---------------------------------------------------------- the mail queue */

interface QueueRow {
  id: string;
  recipient_email: string;
  recipient_name: string;
  subject: string;
  body: string;
}

async function enqueue(message: OutboundMessage): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO mail_queue (recipient_email, recipient_name, subject, body, state)
     VALUES ($1, $2, $3, $4, 'queued') RETURNING id::text`,
    [message.recipientEmail, message.recipientName, message.subject, message.body],
  );
  return rows[0]?.id as string;
}

async function claim(id: string): Promise<QueueRow | null> {
  const rows = await query<QueueRow>(
    `UPDATE mail_queue SET state = 'sending', attempts = attempts + 1
     WHERE id = $1::bigint AND state = 'queued'
     RETURNING id::text, recipient_email, recipient_name, subject, body`,
    [id],
  );
  return rows[0] ?? null;
}

async function markSent(id: string): Promise<void> {
  await pool.query(`UPDATE mail_queue SET state = 'sent', sent_at = now() WHERE id = $1::bigint`, [id]);
}

async function release(id: string): Promise<void> {
  await pool.query(`UPDATE mail_queue SET state = 'queued' WHERE id = $1::bigint`, [id]);
}

/**
 * Queues a message and tries to deliver it at once. Returns whether it went out, so a
 * purchase can report `receipt_email` as `sent` or `delayed`.
 */
export async function send(message: OutboundMessage): Promise<boolean> {
  const id = await enqueue(message);
  const claimed = await claim(id);
  if (!claimed) return false;
  try {
    await deliver(message);
    await markSent(id);
    return true;
  } catch {
    await release(id);
    return false;
  }
}

/** Delivers whatever is still queued; one message goes out exactly once across instances. */
export async function flushQueue(): Promise<void> {
  const rows = await query<QueueRow>(
    `UPDATE mail_queue SET state = 'sending', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM mail_queue WHERE state = 'queued' ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED
     )
     RETURNING id::text, recipient_email, recipient_name, subject, body`,
  );
  for (const row of rows) {
    try {
      await deliver({
        recipientEmail: row.recipient_email,
        recipientName: row.recipient_name,
        subject: row.subject,
        body: row.body,
      });
      await markSent(row.id);
    } catch {
      await release(row.id);
      return;
    }
  }
}
