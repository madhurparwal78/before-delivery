/**
 * The background jobs. Each item is claimed in Postgres with a row lock, so
 * notice delivery, PDF rendering, webhook delivery and background evaluation
 * each run exactly once per item across every server process sharing the
 * database, never twice and never decided in process memory.
 */

import { transaction, writeInstant } from '../db/pool.ts';
import { loadSettlement, markPdfRendered, settlementHtml } from '../market/settlements.ts';
import { refreshMarket } from '../market/refresh.ts';
import { sendNotice } from '../services/mail.ts';
import { renderPdf } from '../services/gotenberg.ts';
import { putObject } from '../services/s3.ts';
import { sendEvent } from '../services/svix.ts';

/** Queued work is attempted within 10 seconds and retried every 10 seconds. */
const RETRY_AFTER_MS = 10000;
const TICK_MS = 2000;

async function deliverNotices(nowMs: number): Promise<void> {
  await transaction(async (client) => {
    const claimed = await client.query<{
      notice_id: string;
      recipient: string;
      subject: string;
      body: string;
    }>(
      `SELECT notice_id, recipient, subject, body FROM notices
       WHERE status = 'queued' AND next_attempt_at <= $1
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED LIMIT 5`,
      [writeInstant(nowMs)],
    );
    for (const notice of claimed.rows) {
      try {
        await sendNotice({
          recipient: notice.recipient,
          subject: notice.subject,
          body: notice.body,
        });
        // A notice reads sent only after the mail server accepts it.
        await client.query(
          "UPDATE notices SET status = 'sent', sent_at = $1 WHERE notice_id = $2",
          [writeInstant(Date.now()), notice.notice_id],
        );
      } catch {
        await client.query(
          'UPDATE notices SET attempts = attempts + 1, next_attempt_at = $1 WHERE notice_id = $2',
          [writeInstant(Date.now() + RETRY_AFTER_MS), notice.notice_id],
        );
      }
    }
  });
}

async function renderStatements(nowMs: number): Promise<void> {
  await transaction(async (client) => {
    const claimed = await client.query<{ settlement_id: string }>(
      `SELECT settlement_id FROM pdf_renders
       WHERE status = 'queued' AND next_attempt_at <= $1
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED LIMIT 3`,
      [writeInstant(nowMs)],
    );
    for (const row of claimed.rows) {
      const record = await loadSettlement(client, row.settlement_id);
      if (record === null) continue;
      const name = await client.query<{ name: string }>(
        'SELECT name FROM actors WHERE actor_id = $1',
        [record.actorId],
      );
      try {
        const pdf = await renderPdf(
          settlementHtml(record, name.rows[0]?.name ?? record.actorId),
        );
        await putObject(record.pdfKey, pdf, 'application/pdf');
        const renderedAt = Date.now();
        await client.query(
          "UPDATE pdf_renders SET status = 'rendered', rendered_at = $1 WHERE settlement_id = $2",
          [writeInstant(renderedAt), row.settlement_id],
        );
        await markPdfRendered(client, row.settlement_id, renderedAt);
      } catch {
        await client.query(
          'UPDATE pdf_renders SET attempts = attempts + 1, next_attempt_at = $1 WHERE settlement_id = $2',
          [writeInstant(Date.now() + RETRY_AFTER_MS), row.settlement_id],
        );
      }
    }
  });
}

async function deliverEvents(nowMs: number): Promise<void> {
  await transaction(async (client) => {
    // Within a position, delivery follows sequence: only the earliest queued
    // event of each position is eligible, so event n+1 is never sent first.
    const claimed = await client.query<{
      event_id: string;
      type: string;
      payload: unknown;
    }>(
      `SELECT e.event_id, e.type, e.payload FROM outbox_events e
       WHERE e.status = 'queued' AND e.next_attempt_at <= $1
         AND (e.position_id IS NULL OR e.sequence = (
               SELECT MIN(p.sequence) FROM outbox_events p
               WHERE p.position_id = e.position_id AND p.status = 'queued'))
       ORDER BY e.seq_no
       FOR UPDATE SKIP LOCKED LIMIT 10`,
      [writeInstant(nowMs)],
    );
    for (const event of claimed.rows) {
      try {
        await sendEvent({ eventId: event.event_id, type: event.type, payload: event.payload });
        await client.query(
          "UPDATE outbox_events SET status = 'delivered', delivered_at = $1 WHERE event_id = $2",
          [writeInstant(Date.now()), event.event_id],
        );
      } catch {
        await client.query(
          'UPDATE outbox_events SET attempts = attempts + 1, next_attempt_at = $1 WHERE event_id = $2',
          [writeInstant(Date.now() + RETRY_AFTER_MS), event.event_id],
        );
      }
    }
  });
}

/** Runs one pass of every job, swallowing the outage of any one service. */
async function tick(): Promise<void> {
  const nowMs = Date.now();
  const jobs = [
    refreshMarket(nowMs),
    deliverNotices(nowMs),
    renderStatements(nowMs),
    deliverEvents(nowMs),
  ];
  await Promise.allSettled(jobs);
}

export function startBackgroundJobs(): void {
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await tick();
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), TICK_MS).unref();
}
