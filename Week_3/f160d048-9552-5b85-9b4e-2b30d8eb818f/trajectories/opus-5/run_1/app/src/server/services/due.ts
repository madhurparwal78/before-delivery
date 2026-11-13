import { serverNow } from '../db/clock';
import { sendDueAlertBatches } from '../domain/alerts';
import { lapseDueClaims } from '../domain/moderation';
import { trimReplayBuffer } from './live';
import { drainOutbox } from './mail';
import { runDueSync } from './sync';

let running = false;

/** Claim lapses, alert batches, outbox sends and search sync, on one pass. */
export async function runDueJobs(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = await serverNow();
    await lapseDueClaims(now);
    await sendDueAlertBatches(now);
    await runDueSync(now);
    await drainOutbox(now);
    await trimReplayBuffer();
  } finally {
    running = false;
  }
}

export function startDueJobLoop(): void {
  setInterval(() => {
    void runDueJobs().catch(() => undefined);
  }, 5000).unref();
}
