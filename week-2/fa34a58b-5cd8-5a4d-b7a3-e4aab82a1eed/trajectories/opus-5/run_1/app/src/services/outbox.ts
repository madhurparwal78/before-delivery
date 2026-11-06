import { randomUUID } from 'node:crypto';
import { query, transaction } from '../db';
import { noticeAddress, toNotice, type NoticeRow } from '../repo';
import type { HouseholdDay } from '../domain/time';
import type { NoticeKind } from '../shared/types';
import { broadcast } from './broadcast';
import { hubNow } from './hubClock';
import { sendNoticeMail } from './mail';

const SEND_INTERVAL_MS = 2000;

/** Writes a notice to the outbox. Returns null when that notice is already queued. */
export async function queueNotice(input: {
  kind: NoticeKind;
  subject: string;
  body: string;
  scheduleId?: string;
  fromDate?: HouseholdDay;
}): Promise<NoticeRow | null> {
  const rows = await query<NoticeRow>(
    `insert into notices (id, kind, subject, body, to_address, state, attempts, created_at, schedule_id, from_date)
     values ($1, $2, $3, $4, $5, 'queued', 0, $6, $7, $8)
     on conflict do nothing
     returning id, kind, subject, body, to_address, state, attempts, created_at, sent_at`,
    [
      randomUUID(),
      input.kind,
      input.subject,
      input.body,
      await noticeAddress(),
      hubNow(),
      input.scheduleId ?? null,
      input.fromDate ?? null,
    ],
  );
  const row = rows[0];
  if (!row) return null;
  broadcast({ type: 'notice', notice: toNotice(row) });
  void runOutbox();
  return row;
}

class NoticeSendFailed extends Error {
  constructor(readonly noticeId: string) {
    super(`Notice ${noticeId} was not accepted`);
  }
}

/**
 * Claims one queued notice at a time, so it never goes out twice: the row lock,
 * the SMTP handover and the sent mark are one transaction.
 */
async function sendOneQueuedNotice(): Promise<boolean> {
  try {
    return await transaction(async (client) => {
      const found = await client.query<NoticeRow>(
        `select id, kind, subject, body, to_address, state, attempts, created_at, sent_at
         from notices where state = 'queued'
         order by sequence
         for update skip locked
         limit 1`,
      );
      const row = found.rows[0];
      if (!row) return false;
      try {
        await sendNoticeMail({
          noticeId: row.id,
          to: row.to_address,
          subject: row.subject,
          body: row.body,
        });
      } catch {
        throw new NoticeSendFailed(row.id);
      }
      const updated = await client.query<NoticeRow>(
        `update notices set state = 'sent', sent_at = $2, attempts = attempts + 1
         where id = $1
         returning id, kind, subject, body, to_address, state, attempts, created_at, sent_at`,
        [row.id, hubNow()],
      );
      const after = updated.rows[0];
      if (after) broadcast({ type: 'notice', notice: toNotice(after) });
      return true;
    });
  } catch (error) {
    if (!(error instanceof NoticeSendFailed)) throw error;
    const rows = await query<NoticeRow>(
      `update notices set attempts = attempts + 1 where id = $1
       returning id, kind, subject, body, to_address, state, attempts, created_at, sent_at`,
      [error.noticeId],
    );
    const row = rows[0];
    if (row) broadcast({ type: 'notice', notice: toNotice(row) });
    return false;
  }
}

let sending = false;

export async function runOutbox(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    for (let guard = 0; guard < 50; guard += 1) {
      const sent = await sendOneQueuedNotice();
      if (!sent) break;
    }
  } finally {
    sending = false;
  }
}

export function startOutbox(): void {
  setInterval(() => {
    void runOutbox();
  }, SEND_INTERVAL_MS).unref();
}
