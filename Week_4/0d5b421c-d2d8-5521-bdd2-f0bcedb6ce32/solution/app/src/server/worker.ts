// Background loops: expiry, lapse, freed tables, email, dependency probes and the stream keep-alive.
import { whenHoldsResume, recordDeposits, recordHolds } from "./dependencies.js";
import { broadcastResync, keepOpen } from "./events.js";
import { expireHolds } from "./holds.js";
import { purgeIdempotencyRecords } from "./idempotency.js";
import { probeKillBill } from "./killbill.js";
import { sendQueuedEmails } from "./mailer.js";
import { lapseOffers, offerFreedTablesToWaitlist } from "./offers.js";
import { ping } from "./valkey.js";

function every(milliseconds: number, task: () => Promise<void>): void {
  const tick = (): void => {
    task()
      .catch((error: unknown) => console.error(error instanceof Error ? error.message : "background task failed"))
      .finally(() => setTimeout(tick, milliseconds).unref());
  };
  setTimeout(tick, milliseconds).unref();
}

export async function probeDependencies(): Promise<void> {
  await Promise.all([
    ping().then(() => recordHolds(true), () => recordHolds(false)),
    probeKillBill().then(() => recordDeposits(true), () => recordDeposits(false)),
  ]);
}

export function startWorkers(): void {
  whenHoldsResume(() => {
    broadcastResync();
    void offerFreedTablesToWaitlist().catch(() => undefined);
  });
  every(500, async () => {
    await expireHolds();
    await lapseOffers();
    await offerFreedTablesToWaitlist();
  });
  every(500, sendQueuedEmails);
  every(2_000, probeDependencies);
  every(15_000, async () => keepOpen());
  every(3_600_000, purgeIdempotencyRecords);
}
