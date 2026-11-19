/** Start-up and background work: apply the schema and seed once the database answers; watch it; post and expire on time. */
import { businessNow } from "./clock.js";
import { DatabaseUnavailable, databaseState, ping, snapshotRead, transaction } from "./db.js";
import { findDueWork, processDue } from "./domain/payments.js";
import { applySchema } from "./schema.js";
import { seedIfEmpty } from "./seed.js";

const RETRY_MS = 2_000;
const WATCH_MS = 1_000;
const DUE_WORK_MS = 3_000;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Keeps trying until the database is reachable, then makes it ready; never exits because of the database. */
export async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await transaction((tx) => seedIfEmpty(tx, businessNow()));
      databaseState.reachable = true;
      databaseState.ready = true;
      return;
    } catch (error) {
      databaseState.reachable = false;
      if (!(error instanceof DatabaseUnavailable)) console.error(error);
      await pause(RETRY_MS);
    }
  }
}

/** Notices an outage, and the recovery, without waiting for a request to fail. */
export function watchDatabase(): void {
  setInterval(() => {
    if (databaseState.ready) void ping();
  }, WATCH_MS);
}

/** Posts scheduled payments and expires held ones, each exactly once, in due order. */
export function runDueWork(): void {
  void (async () => {
    for (;;) {
      await pause(DUE_WORK_MS);
      if (!databaseState.ready || !databaseState.reachable) continue;
      try {
        const now = businessNow();
        const work = await snapshotRead((tx) => findDueWork(tx, now));
        for (const item of work) {
          try {
            await transaction((tx) => processDue(tx, item, businessNow()));
          } catch (error) {
            if (databaseState.reachable) console.error(error);
          }
        }
      } catch (error) {
        if (databaseState.reachable) console.error(error);
      }
    }
  })();
}
