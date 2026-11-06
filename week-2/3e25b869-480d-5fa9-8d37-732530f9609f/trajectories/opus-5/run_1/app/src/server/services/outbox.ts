import type { Locale, Notice, NoticeKind, NoticeStatus } from '../../shared/types.js';
import { LIMITS } from '../config.js';
import { takeNumber } from '../db/numbers.js';
import { db, type Queryable } from '../db/pool.js';
import { maskCodeSubject } from '../email/templates.js';
import { orderedAttempt } from '../repo/normalize.js';
import { smtp } from './smtp.js';

export type NoticeDraft = {
  key: string;
  kind: NoticeKind;
  recipient: string;
  locale: Locale;
  subject: string;
  body: string;
};

type NoticeRow = {
  number: string;
  key: string;
  kind: NoticeKind;
  recipient: string;
  locale: Locale;
  subject: string;
  body: string;
  status: NoticeStatus;
  enqueued_at: Date;
  attempts: { at: string; outcome: 'sent' | 'failed' }[];
};

let mailUp = true;
let lastMailChange = new Date();

export function mailStatus(): { up: boolean; checkedAt: Date } {
  return { up: mailUp, checkedAt: lastMailChange };
}

function setMailUp(up: boolean): void {
  if (mailUp !== up) {
    mailUp = up;
    lastMailChange = new Date();
  }
}

/** Queued in the same unit as the event that causes it; a key is never queued twice. */
export async function enqueueNotice(client: Queryable, draft: NoticeDraft): Promise<string> {
  const number = await takeNumber(client, 'notice');
  await client.query(
    `INSERT INTO notices (number, key, kind, recipient, locale, subject, body, status, enqueued_at, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', now(), now())
     ON CONFLICT (key) DO NOTHING`,
    [number, draft.key, draft.kind, draft.recipient, draft.locale, draft.subject, draft.body],
  );
  return number;
}

export function serializeNotice(row: NoticeRow): Notice {
  return {
    number: row.number,
    key: row.key,
    kind: row.kind,
    to: row.recipient,
    locale: row.locale,
    subject: row.kind === 'stepup_code' ? maskCodeSubject(row.subject) : row.subject,
    status: row.status,
    enqueued_at: row.enqueued_at.toISOString(),
    attempts: row.attempts.map(orderedAttempt),
  };
}

const NOTICE_COLUMNS =
  'number, key, kind, recipient, locale, subject, body, status, enqueued_at, attempts';

export async function listNotices(status: NoticeStatus | null): Promise<Notice[]> {
  const result = await db.query<NoticeRow>(
    `SELECT ${NOTICE_COLUMNS} FROM notices
     ${status ? 'WHERE status = $1' : ''}
     ORDER BY enqueued_at DESC, number DESC`,
    status ? [status] : [],
  );
  return result.rows.map(serializeNotice);
}

export async function findNotice(number: string): Promise<Notice | null> {
  const result = await db.query<NoticeRow>(
    `SELECT ${NOTICE_COLUMNS} FROM notices WHERE number = $1`,
    [number],
  );
  const row = result.rows[0];
  return row ? serializeNotice(row) : null;
}

/** Of simultaneous resends of one failed notice exactly one wins, because only one row updates. */
export async function resendNotice(number: string): Promise<Notice | null> {
  const result = await db.query<NoticeRow>(
    `UPDATE notices
        SET status = 'queued', attempts = '[]'::jsonb, enqueued_at = now(), due_at = now(), claimed_at = NULL
      WHERE number = $1 AND status = 'failed'
      RETURNING ${NOTICE_COLUMNS}`,
    [number],
  );
  const row = result.rows[0];
  if (!row) return null;
  void drainOnce();
  return serializeNotice(row);
}

async function claimDueNotice(): Promise<NoticeRow | null> {
  const result = await db.query<NoticeRow>(
    `UPDATE notices SET claimed_at = now()
      WHERE number = (
        SELECT number FROM notices
         WHERE status IN ('queued', 'retrying') AND due_at <= now() AND claimed_at IS NULL
         ORDER BY enqueued_at ASC, number ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING ${NOTICE_COLUMNS}`,
  );
  return result.rows[0] ?? null;
}

async function recordAttempt(row: NoticeRow, startedAt: Date, sent: boolean): Promise<void> {
  const attemptCount = row.attempts.length + 1;
  const attempt = { at: startedAt.toISOString(), outcome: sent ? 'sent' : 'failed' };
  if (sent) {
    await db.query(
      `UPDATE notices
          SET status = 'sent', attempts = attempts || $2::jsonb, claimed_at = NULL
        WHERE number = $1`,
      [row.number, JSON.stringify([attempt])],
    );
    return;
  }
  if (attemptCount >= LIMITS.noticeMaxAttempts) {
    await db.query(
      `UPDATE notices
          SET status = 'failed', attempts = attempts || $2::jsonb, claimed_at = NULL
        WHERE number = $1`,
      [row.number, JSON.stringify([attempt])],
    );
    return;
  }
  const delay = LIMITS.noticeRetryDelaysMs[attemptCount - 1] ?? 0;
  await db.query(
    `UPDATE notices
        SET status = 'retrying', attempts = attempts || $2::jsonb, claimed_at = NULL,
            due_at = $3
      WHERE number = $1`,
    [row.number, JSON.stringify([attempt]), new Date(startedAt.getTime() + delay)],
  );
}

let draining = false;

async function drainOnce(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const row = await claimDueNotice();
      if (!row) return;
      const startedAt = new Date();
      try {
        await smtp.send({
          to: row.recipient,
          subject: row.subject,
          messageId: `<${row.key}@paindelune.example>`,
          body: row.body,
        });
        setMailUp(true);
        await recordAttempt(row, startedAt, true);
      } catch {
        setMailUp(false);
        await recordAttempt(row, startedAt, false);
        return;
      }
    }
  } catch {
    // A database hiccup leaves this notice claimed; releaseStaleClaims picks it up again.
  } finally {
    draining = false;
  }
}

async function releaseStaleClaims(): Promise<void> {
  await db
    .query(`UPDATE notices SET claimed_at = NULL WHERE claimed_at < now() - interval '60 seconds'`)
    .catch(() => undefined);
}

async function probeMail(): Promise<void> {
  await releaseStaleClaims();
  try {
    await smtp.probe();
    if (!mailUp) {
      setMailUp(true);
      await db.query(`UPDATE notices SET due_at = now() WHERE status IN ('queued', 'retrying')`);
    }
  } catch {
    setMailUp(false);
  }
}

export function startOutbox(): void {
  setInterval(() => void drainOnce(), 500);
  setInterval(() => void probeMail(), LIMITS.monitorIntervalMs);
  void probeMail();
}

export function wakeOutbox(): void {
  void drainOnce();
}
