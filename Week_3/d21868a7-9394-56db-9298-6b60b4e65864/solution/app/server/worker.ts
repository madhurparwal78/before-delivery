// Retries everything that waits on the evidence store or the mail service: strokes waiting for the
// store, packs being stored and mailed, withdrawn packs' objects, and queued notices.
import { storeStroke, waitingCards } from "./cards.ts";
import { read } from "./db.ts";
import { sendQueuedNotices } from "./notices.ts";
import { advancePacks } from "./packs.ts";

const RETRY_MS = 5000;

let running = false;
let again = false;

async function runOnce(): Promise<void> {
  for (const card of await read(waitingCards)) await storeStroke(card);
  await advancePacks();
  await sendQueuedNotices().catch(() => undefined);
}

/** Runs a pass now, or right after the pass in flight. */
export function kickWorker(): void {
  if (running) {
    again = true;
    return;
  }
  running = true;
  void (async () => {
    do {
      again = false;
      await runOnce().catch((error: Error) => console.error(`worker: ${error.message}`));
    } while (again);
    running = false;
  })();
}

export function startWorker(): void {
  setInterval(kickWorker, RETRY_MS).unref();
  kickWorker();
}
