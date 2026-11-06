import { pool, query, withAdvisoryLock } from '../db/pool';
import { warnExpiringCredentials } from '../domain/credentials';
import { sweepExpiredOffers } from '../domain/offers';
import { refreshRequestStatus } from '../domain/requests';
import { deliverQueuedEmails } from '../services/mail';

const OUTBOX_INTERVAL_MS = 3000;
const SWEEP_INTERVAL_MS = 20000;
const WARNING_INTERVAL_MS = 1800000;

let outboxRunning = false;

/** Delivers the outbox now, after an action queued something. */
export function kickOutbox(): void {
  void runOutbox();
}

async function runOutbox(): Promise<void> {
  if (outboxRunning) return;
  outboxRunning = true;
  try {
    await deliverQueuedEmails();
  } catch (error) {
    console.error('outbox delivery failed', error);
  } finally {
    outboxRunning = false;
  }
}

/** Marks expired offers and persists statuses that have become `completed`. */
async function runSweep(): Promise<void> {
  const now = new Date();
  await withAdvisoryLock('seatweaver:sweep', async () => {
    await sweepExpiredOffers(now);
    const stale = await query<{ id: string }>(
      pool,
      `select r.id from requests r
       where r.status in ('submitted', 'partially_staffed', 'staffed')
         and r.end_at <= $1`,
      [now],
    );
    for (const request of stale) {
      await refreshRequestStatus(request.id, null, now);
    }
  });
}

async function runWarnings(): Promise<void> {
  await withAdvisoryLock('seatweaver:credential-warnings', async () => {
    await warnExpiringCredentials(new Date());
  });
}

function repeat(task: () => Promise<void>, intervalMs: number): void {
  const tick = async (): Promise<void> => {
    try {
      await task();
    } catch (error) {
      console.error('background task failed', error);
    }
    setTimeout(() => void tick(), intervalMs).unref();
  };
  void tick();
}

export function startBackgroundWork(): void {
  repeat(runOutbox, OUTBOX_INTERVAL_MS);
  repeat(runSweep, SWEEP_INTERVAL_MS);
  repeat(runWarnings, WARNING_INTERVAL_MS);
}
