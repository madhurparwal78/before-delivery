// The outbox: every customer email is a notice queued with its event, sent once by one sender,
// oldest first, retried after 5, 15 and 45 seconds, and failed after the fourth attempt.
import { config } from './config.js';
import { type Db, nextNumber, pool, tx } from './db.js';
import type { NoticeDraft } from './emails.js';
import { deliver, probe } from './smtp.js';

const RETRY_DELAYS_S = [5, 15, 45];
const MAX_ATTEMPTS = 4;
const SENDER_LOCK = 7340002;
const CHECK_EVERY_MS = 5000;
const TICK_MS = 250;

interface Attempt {
  at: string;
  outcome: 'sent' | 'failed';
}

interface NoticeRow {
  number: string;
  key: string;
  kind: string;
  recipient: string;
  locale: string;
  subject: string;
  public_subject: string;
  body: string;
  status: string;
  enqueued_at: Date;
  attempts: Attempt[];
}

interface Notice {
  number: string;
  key: string;
  kind: string;
  to: string;
  locale: string;
  subject: string;
  status: string;
  enqueued_at: string;
  attempts: Attempt[];
}

export const noticeJson = (n: NoticeRow): Notice => ({
  number: n.number,
  key: n.key,
  kind: n.kind,
  to: n.recipient,
  locale: n.locale,
  subject: n.public_subject,
  status: n.status,
  enqueued_at: n.enqueued_at.toISOString(),
  attempts: n.attempts,
});

/** Queues a notice inside the caller's transaction; a key is never queued twice. */
export async function enqueue(db: Db, draft: NoticeDraft, now: Date): Promise<void> {
  const number = await nextNumber(db, 'NT');
  await db.query(
    `INSERT INTO notices (number, key, kind, recipient, locale, subject, public_subject, body, status, enqueued_at, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$9)`,
    [number, draft.key, draft.kind, draft.recipient, draft.locale, draft.subject, draft.publicSubject, draft.body, now],
  );
}

let mailUp: boolean | null = null;

export const mailStatus = (): 'up' | 'down' => (mailUp === false ? 'down' : 'up');

async function markReachable(): Promise<void> {
  const recovering = mailUp === false;
  mailUp = true;
  if (recovering) {
    await pool.query(`UPDATE notices SET next_attempt_at = $1 WHERE status IN ('queued','retrying')`, [new Date()]);
  }
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function message(n: NoticeRow): string {
  const body = Buffer.from(n.body.replace(/\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${config.mail.from}`,
    `To: ${n.recipient}`,
    `Subject: ${encodeHeader(n.subject)}`,
    `Message-ID: <${n.key}@${config.mail.domain}>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** Sends the oldest due notice, if this instance holds the sender lock. Returns whether one was handled. */
async function sendOne(): Promise<boolean> {
  return tx(async (db) => {
    const lock = (await db.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [SENDER_LOCK])).rows[0];
    if (!lock?.ok) return false;
    const notice = (await db.query<NoticeRow>(`SELECT * FROM notices WHERE status IN ('queued','retrying') AND next_attempt_at <= $1
       ORDER BY enqueued_at, number LIMIT 1 FOR UPDATE`,
      [new Date()],
    )).rows[0];
    if (!notice) return false;
    const started = new Date();
    let outcome: Attempt['outcome'] = 'sent';
    try {
      await deliver(notice.recipient, message(notice));
    } catch {
      outcome = 'failed';
    }
    const attempts = [...notice.attempts, { at: started.toISOString(), outcome }];
    if (outcome === 'sent') {
      await db.query(`UPDATE notices SET status = 'sent', attempts = $2 WHERE number = $1`, [notice.number, JSON.stringify(attempts)]);
    } else {
      const failed = attempts.length >= MAX_ATTEMPTS;
      const delay = failed ? 0 : (RETRY_DELAYS_S[attempts.length - 1] as number);
      await db.query(`UPDATE notices SET status = $2, attempts = $3, next_attempt_at = $4 WHERE number = $1`, [
        notice.number,
        failed ? 'failed' : 'retrying',
        JSON.stringify(attempts),
        new Date(started.getTime() + delay * 1000),
      ]);
    }
    if (outcome === 'sent') await markReachable();
    else mailUp = false;
    return true;
  });
}

let draining = false;

/** Sends every due notice now, one at a time. */
export async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (await sendOne());
  } catch (error) {
    console.error(`outbox: ${(error as Error).message}`);
  } finally {
    draining = false;
  }
}

async function check(): Promise<void> {
  try {
    await probe();
    await markReachable();
    void drain();
  } catch {
    mailUp = false;
  }
}

export function startOutbox(): void {
  setInterval(() => void drain(), TICK_MS).unref();
  setInterval(() => void check(), CHECK_EVERY_MS).unref();
  void check();
}

/** Puts a failed notice back in the queue with a fresh attempt list; exactly one of simultaneous resends wins. */
export async function resend(number: string, now: Date): Promise<NoticeRow | undefined> {
  const notice = (await pool.query<NoticeRow>(`UPDATE notices SET status = 'queued', attempts = '[]', enqueued_at = $2, next_attempt_at = $2
     WHERE number = $1 AND status = 'failed' RETURNING *`,
    [number, now],
  )).rows[0];
  if (notice) void drain();
  return notice;
}

export async function listNotices(status: string | null): Promise<Notice[]> {
  const found = (await pool.query<NoticeRow>(`SELECT * FROM notices WHERE ($1::text IS NULL OR status = $1) ORDER BY enqueued_at DESC, number DESC`,
    [status],
  )).rows;
  return found.map(noticeJson);
}

export async function noticeStatus(number: string): Promise<string | undefined> {
  return ((await pool.query<{ status: string }>('SELECT status FROM notices WHERE number = $1', [number])).rows[0])?.status;
}
