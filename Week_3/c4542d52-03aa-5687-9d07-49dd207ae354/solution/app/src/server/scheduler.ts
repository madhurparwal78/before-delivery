import { transaction } from "./db.js";
import { announceVestedTranches, expireDueOffers, settleEndedWindows, warnDueOffers } from "./grants.js";
import { warnLeavers } from "./departures.js";
import { pollPendingExerciseOrders, retryProviderCancels } from "./exercises.js";
import { closeDueTenders } from "./tenders.js";
import { loadValuations } from "./registry.js";
import { announceValuation, valuationState } from "./valuations.js";

/** Whatever the server clock has made due: expiries, warnings, window ends, vests, tender closes, payment records. */
async function tick(): Promise<void> {
  await transaction(async (tx) => {
    await expireDueOffers(tx, null);
    await warnDueOffers(tx);
    await settleEndedWindows(tx, null);
    await announceVestedTranches(tx);
    await warnLeavers(tx);
  });
  await closeDueTenders();
  await transaction(async (tx) => {
    const [stored] = await tx.query<{ value: string }>("SELECT value #>> '{}' AS value FROM settings WHERE key = 'valuation_state' FOR UPDATE");
    const { current } = await loadValuations(tx);
    if (stored?.value === valuationState(current)) return;
    await tx.query("UPDATE settings SET value = to_jsonb($1::text) WHERE key = 'valuation_state'", [valuationState(current)]);
    tx.emit({ to: null, type: "changed", data: { topics: ["valuations"] } });
    await announceValuation(tx, current);
  });
  await pollPendingExerciseOrders();
  await retryProviderCancels();
}

export function startScheduler(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    tick()
      .catch((error: unknown) => console.error("scheduler tick failed", error))
      .finally(() => {
        running = false;
      });
  }, 1000);
}
