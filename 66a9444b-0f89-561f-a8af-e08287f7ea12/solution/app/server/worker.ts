// The background pass every instance runs each second: publishing, expiries, lapses, Kill Bill work and mail.
// Each step claims its rows with locks, so several instances sharing the database never repeat an effect.
import { forgetOldKeys } from "./domain/idempotency.ts";
import { invoiceSweep } from "./domain/invoices.ts";
import { deliverOutbox } from "./domain/outbox.ts";
import { proofLapseSweep } from "./domain/proofs.ts";
import { paymentTaskSweep } from "./domain/refunds.ts";
import { settleDueSessions } from "./domain/seats.ts";
import { publishSweep } from "./domain/stateMachine.ts";

const STEPS: [string, () => Promise<void>][] = [
  ["publish", publishSweep],
  ["seats", settleDueSessions],
  ["proof lapses", proofLapseSweep],
  ["payment tasks", paymentTaskSweep],
  ["invoices", invoiceSweep],
  ["outbox", deliverOutbox],
];

const PERIOD_MS = 1000;
const KEY_CLEANUP_EVERY = 3600;

let running = false;
let passes = 0;

async function pass(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const [name, step] of STEPS) {
      await step().catch((error: unknown) => console.error(`[worker] ${name}: ${error instanceof Error ? error.message : String(error)}`));
    }
    if (++passes % KEY_CLEANUP_EVERY === 0) await forgetOldKeys().catch(() => undefined);
  } finally {
    running = false;
  }
}

export function startWorker(): void {
  setInterval(() => void pass(), PERIOD_MS).unref();
}

/** Runs a pass straight after a state-changing request, so its mail and Kill Bill work don't wait a second. */
export function kick(): void {
  void pass();
}
