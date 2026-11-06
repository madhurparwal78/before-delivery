import { advanceTopup } from '../domain/billing';
import { claimPendingTopup, pendingTopupsDue } from '../store/topups';

let busy = false;

async function tick(): Promise<void> {
  for (const topup of await pendingTopupsDue()) {
    if (await claimPendingTopup(topup.id)) await advanceTopup(topup);
  }
}

/** Retries every pending top-up every fifteen seconds until billing answers. */
export function startTopupRetries(): void {
  setInterval(() => {
    if (busy) return;
    busy = true;
    tick()
      .catch((error: unknown) => console.error('top-up retry failed', error))
      .finally(() => {
        busy = false;
      });
  }, 5000).unref();
}
