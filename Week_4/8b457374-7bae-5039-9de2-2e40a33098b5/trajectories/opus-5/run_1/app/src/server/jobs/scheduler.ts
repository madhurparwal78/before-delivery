import { pool } from '../data/db.js';
import { listQueuedNotices, markNoticeSent } from '../data/notices.js';
import { storeSeedCovers } from '../data/seed.js';
import {
  runCloseOuts,
  runCollectionRetries,
  runFinalAttempts,
  runFixNotices,
} from '../operations/collection.js';
import {
  renderPendingSettlements,
  renderPendingStatements,
} from '../operations/documentOps.js';
import { probeDocuments } from '../services/gotenberg.js';
import { probeEmail, sendMail } from '../services/mail.js';
import { probePayments } from '../services/killbill.js';
import { probeStorage } from '../services/storage.js';

/** Sends every queued notice; one that fails stays queued for the next pass. */
async function flushNotices(): Promise<void> {
  for (const notice of await listQueuedNotices(pool, 50)) {
    try {
      await sendMail(notice.to_email, notice.subject, notice.body);
    } catch {
      return;
    }
    await markNoticeSent(pool, notice.id);
  }
}

async function probeAll(): Promise<void> {
  await Promise.all([probePayments(), probeEmail(), probeStorage(), probeDocuments()]);
}

function every(milliseconds: number, work: () => Promise<void>): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await work();
    } catch (error) {
      process.stderr.write(`job failed: ${String(error)}\n`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), milliseconds);
  timer.unref();
  void tick();
}

export function startJobs(): void {
  // Close-out and the final collection attempt both run within 5 seconds of becoming due.
  every(1_000, runCloseOuts);
  every(1_000, runFinalAttempts);
  every(2_000, runFixNotices);
  every(2_000, flushNotices);
  every(10_000, runCollectionRetries);
  every(5_000, renderPendingStatements);
  every(5_000, renderPendingSettlements);
  every(10_000, probeAll);
  every(10_000, storeSeedCovers);
}
