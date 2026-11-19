import { iso, nowMs } from './clock';
import { query, tx } from './db';
import { sweepExpiredHolds } from './domain/bookings';
import { sweepAllExpiry } from './domain/expiry';
import { queueExpiryNotice } from './domain/mail';
import { memberById, validThroughFor } from './domain/members';
import { deliver } from './services/smtp';
import { daysBetween, localDateOf } from '../shared/tz';
import type { DocumentType } from '../shared/types';

const DOCUMENT_TYPES: DocumentType[] = [
  'certificate_of_insurance',
  'food_handler_certificate',
  'business_licence',
];

/** Each member's document types get at most one 14-day and one 3-day notice per date. */
export async function scanExpiryNotices(): Promise<void> {
  const members = await query<{ id: string }>('select id from members');
  for (const row of members) {
    const member = await memberById(row.id);
    if (member === null) continue;
    const today = localDateOf(member.home_zone, nowMs());
    const validThrough = await validThroughFor(null, member);
    for (const type of DOCUMENT_TYPES) {
      const date = validThrough[type];
      if (date === null) continue;
      const daysLeft = daysBetween(today, date);
      const kind = daysLeft >= 4 && daysLeft <= 14 ? '14-day' : daysLeft >= 0 && daysLeft <= 3 ? '3-day' : null;
      if (kind === null) continue;
      await tx(async (client) => {
        await queueExpiryNotice(client, {
          memberId: member.id,
          memberEmail: member.email,
          documentType: type,
          validThrough: date,
          kind,
        });
      });
    }
  }
}

/** Delivers the outbox, retrying while SMTP is unreachable. */
export async function deliverOutbox(): Promise<void> {
  const pending = await query<{ id: string; to_email: string; subject: string; body: string }>(
    `select id::text as id, to_email, subject, body from outbox
      where sent_at is null order by id asc limit 20`,
  );
  for (const mail of pending) {
    const claimed = await query<{ id: string }>(
      `update outbox set attempts = attempts + 1 where id = $1 and sent_at is null returning id::text as id`,
      [mail.id],
    );
    if (claimed.length === 0) continue;
    try {
      await deliver({ to: mail.to_email, subject: mail.subject, body: mail.body });
      await query('update outbox set sent_at = $2 where id = $1', [mail.id, iso(nowMs())]);
    } catch {
      /* left pending, so the next pass retries */
    }
  }
}

function every(ms: number, run: () => Promise<void>): void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    run()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, ms);
  timer.unref();
}

export function startWorkers(): void {
  every(500, sweepExpiredHolds);
  every(2000, sweepAllExpiry);
  every(15000, scanExpiryNotices);
  every(1000, deliverOutbox);
}
