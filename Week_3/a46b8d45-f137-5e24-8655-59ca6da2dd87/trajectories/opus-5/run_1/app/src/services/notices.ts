/**
 * The notice queue. Every notice except the confirmation is written to the shared queue in
 * Postgres together with the action that caused it, so a decline and its notice are kept or
 * dropped together.
 *
 * Every copy checks the queue, and each waiting notice is sent exactly once by whichever
 * copy reaches Mailpit first: the row is held under a lock for the whole send, so a second
 * copy skips it and a failed send simply leaves it waiting.
 */

import { config } from '../config';
import { withTransaction, type Transaction } from '../db/pool';
import { now } from '../domain/time';
import {
  coverEndLine,
  linkLifetimeLine,
  noticeSubject,
  paidLine,
  partAmountLine,
  carriageAmountLine,
  promiseLine,
  totalLine,
  type NoticeKind,
} from '../shared/copy';
import type { Language } from '../shared/format';
import { sendNotice } from './smtp';

const QUEUE_SWEEP_MS = 10_000;

/** Everything a notice needs, with every amount already read back from Kill Bill. */
export interface NoticeFigures {
  confirmBy?: string;
  confirmToken?: string;
  shareToken?: string;
  partLineMinor?: number;
  carriageMinor?: number;
  totalMinor?: number;
  band?: string;
  promiseKind?: 'same_day' | 'later';
  promiseDate?: string;
  paidMinor?: number;
  refundedMinor?: number;
  coverEndsAt?: string;
}

export interface NoticeRequest {
  reference: string;
  kind: NoticeKind;
  language: Language;
  recipient: string;
  figures: NoticeFigures;
}

function shareUrl(token: string): string {
  return `${config.publicUrl}/s/${token}`;
}

function confirmUrl(token: string): string {
  return `${config.publicUrl}/confirm/${token}`;
}

/**
 * A notice never carries the owner's name, postcode, description, photos or any Kill Bill id.
 */
function noticeBody(request: NoticeRequest): string {
  const { kind, language, figures, reference } = request;
  const lines: string[] = [];

  switch (kind) {
    case 'confirmation':
      lines.push(confirmUrl(figures.confirmToken ?? ''));
      if (figures.confirmBy !== undefined) lines.push(linkLifetimeLine(figures.confirmBy, language));
      break;
    case 'quoted':
      lines.push(partAmountLine(figures.partLineMinor ?? 0, language));
      lines.push(carriageAmountLine(figures.band ?? '', figures.carriageMinor ?? 0, language));
      lines.push(totalLine(figures.totalMinor ?? 0, language));
      if (figures.promiseKind !== undefined && figures.promiseDate !== undefined) {
        lines.push(promiseLine(figures.promiseKind, figures.promiseDate, language));
      }
      if (figures.coverEndsAt !== undefined) lines.push(coverEndLine(figures.coverEndsAt, language));
      if (figures.shareToken !== undefined) lines.push(shareUrl(figures.shareToken));
      break;
    case 'declined':
      if (figures.shareToken !== undefined) lines.push(shareUrl(figures.shareToken));
      break;
    case 'dispatched':
      lines.push(paidLine(figures.paidMinor ?? 0, language));
      if (figures.shareToken !== undefined) lines.push(shareUrl(figures.shareToken));
      break;
    case 'closed':
      // The closed notice carries no link.
      lines.push(noticeSubject('closed', reference, language));
      break;
    case 'new_link':
      if (figures.shareToken !== undefined) lines.push(shareUrl(figures.shareToken));
      break;
  }

  return lines.join('\n');
}

function subjectFor(request: NoticeRequest): string {
  return noticeSubject(request.kind, request.reference, request.language, {
    totalMinor: request.figures.totalMinor,
    refundedMinor: request.figures.refundedMinor,
  });
}

/** Written in the same transaction as the action that caused it. */
export async function queueNotice(tx: Transaction, request: NoticeRequest): Promise<void> {
  await tx.query(
    `INSERT INTO notice_queue (reference, notice, language, recipient, payload, state, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'waiting', $6)`,
    [request.reference, request.kind, request.language, request.recipient, JSON.stringify(request.figures), now()],
  );
}

/** The confirmation email is sent while the claim start runs, never queued. */
export async function sendConfirmationNotice(request: NoticeRequest): Promise<void> {
  await sendNotice({ to: request.recipient, subject: subjectFor(request), body: noticeBody(request) });
}

interface QueueRow {
  id: string;
  reference: string;
  notice: NoticeKind;
  language: Language;
  recipient: string;
  payload: NoticeFigures;
}

/**
 * Sends one waiting notice, holding its row for the whole send. Returns false when the
 * queue is empty or another copy already holds the next notice.
 */
async function sendOneWaitingNotice(): Promise<boolean> {
  return withTransaction(async (tx) => {
    const row = await tx.queryOne<QueueRow>(
      `SELECT id::text, reference, notice, language, recipient, payload
         FROM notice_queue
        WHERE state = 'waiting'
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
    );
    if (row === null) return false;

    const request: NoticeRequest = {
      reference: row.reference,
      kind: row.notice,
      language: row.language,
      recipient: row.recipient,
      figures: row.payload,
    };
    // A refused send throws, which rolls back and leaves the notice waiting.
    await sendNotice({ to: request.recipient, subject: subjectFor(request), body: noticeBody(request) });
    await tx.query(`UPDATE notice_queue SET state = 'sent', sent_at = $2 WHERE id = $1`, [row.id, now()]);
    return true;
  });
}

async function sweepQueue(): Promise<void> {
  // Keep going while notices are waiting, so a backlog clears in one sweep.
  let sent = true;
  while (sent) sent = await sendOneWaitingNotice();
}

export function watchNoticeQueue(): void {
  const tick = (): void => {
    void sweepQueue()
      .catch(() => undefined)
      .finally(() => setTimeout(tick, QUEUE_SWEEP_MS).unref());
  };
  setTimeout(tick, QUEUE_SWEEP_MS).unref();
}
