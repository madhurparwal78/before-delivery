import { config } from '../config.ts';
import { query } from '../db/pool.ts';
import { attemptSeal } from '../model/flow.ts';
import { retryHeldEmails } from '../model/mailer.ts';
import { health } from './health.ts';

const TICK_MS = 1000;

/**
 * Retries seals that failed. Only an instance whose email and storage both pass
 * its latest health check takes part, and no sooner than the retry interval
 * after the last failed attempt.
 */
const retrySeals = async (): Promise<void> => {
  const current = health();
  if (!current.mail || !current.storage) return;
  const due = await query<{ id: string }>(
    `SELECT id FROM documents
     WHERE status = 'sealing' AND seal_failed_at IS NOT NULL
       AND seal_failed_at <= now() - ($1 || ' seconds')::interval
     LIMIT 5`,
    [String(config.sealRetrySeconds)],
  );
  for (const row of due) {
    await attemptSeal(row.id);
  }
};

export const startWorkers = (): void => {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        await retryHeldEmails();
        await retrySeals();
      } catch (error) {
        process.stderr.write(`worker tick failed: ${String(error)}\n`);
      } finally {
        running = false;
      }
    })();
  }, TICK_MS).unref();
};
