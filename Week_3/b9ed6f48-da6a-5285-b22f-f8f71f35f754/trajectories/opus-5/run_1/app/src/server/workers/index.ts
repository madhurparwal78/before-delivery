import { query, withAdvisoryLock, withTransaction } from '../db/index.js';
import { record } from '../domain/audit.js';
import { runDueRetry, type DunningRow } from '../domain/membership.js';
import { syncCatalog } from '../domain/prices.js';
import { flushQueue } from '../services/mail.js';
import { ensureCollections } from '../services/pocketbase.js';
import { applyAccountSeed, applyMediaSeed } from '../seed/index.js';

const PUBLISH_INTERVAL_MS = 2_000;
const DUNNING_INTERVAL_MS = 5_000;
const MAIL_INTERVAL_MS = 3_000;
const PROVIDER_INTERVAL_MS = 15_000;

/** A scheduled item is published exactly once, whichever instance gets there first. */
async function publishDueItems(): Promise<void> {
  await withTransaction(async (tx) => {
    const chapters = await tx.query<{ number: number }>(
      `UPDATE archive_chapters SET status = 'published'
       WHERE status = 'scheduled' AND publish_at <= now() RETURNING number`,
    );
    const events = await tx.query<{ id: string }>(
      `UPDATE timeline_events SET status = 'published'
       WHERE status = 'scheduled' AND publish_at <= now() RETURNING id`,
    );
    for (const chapter of chapters) {
      await record(
        {
          actorEmail: 'system',
          action: 'published',
          targetType: 'chapter',
          targetId: `chapter-${chapter.number}`,
        },
        tx,
      );
    }
    for (const event of events) {
      await record(
        { actorEmail: 'system', action: 'published', targetType: 'event', targetId: event.id },
        tx,
      );
    }
  });
}

async function runDueDunning(): Promise<void> {
  const claimed = await query<DunningRow>(
    `UPDATE dunning_state SET state = 'retrying'
     WHERE user_id IN (
       SELECT user_id FROM dunning_state
       WHERE state = 'active' AND next_retry_at IS NOT NULL AND next_retry_at <= now()
       ORDER BY next_retry_at LIMIT 5 FOR UPDATE SKIP LOCKED
     )
     RETURNING user_id, invoice_id, order_kind, amount_minor::text, currency, failed_at, attempts, next_retry_at, state`,
  );
  for (const row of claimed) {
    await withAdvisoryLock(`membership:${row.user_id}`, () => runDueRetry(row));
  }
}

function every(intervalMs: number, run: () => Promise<void>): void {
  const timer = setInterval(() => {
    void run().catch(() => undefined);
  }, intervalMs);
  timer.unref();
}

/** Providers that were down at boot are picked up again without a restart. */
async function catchUpProviders(): Promise<void> {
  await ensureCollections().catch(() => undefined);
  await applyAccountSeed().catch(() => undefined);
  await syncCatalog().catch(() => undefined);
  await applyMediaSeed().catch(() => undefined);
}

export function startWorkers(): void {
  every(PUBLISH_INTERVAL_MS, publishDueItems);
  every(DUNNING_INTERVAL_MS, runDueDunning);
  every(MAIL_INTERVAL_MS, flushQueue);
  every(PROVIDER_INTERVAL_MS, catchUpProviders);
  void catchUpProviders();
}
