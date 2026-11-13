import { forgetOld } from "./idempotency.js";
import { database, pool } from "./db.js";
import { runDueCloses } from "./domain/close.js";
import { serialized } from "./mutate.js";

const TICK_MS = 2000;
const PURGE_EVERY_TICKS = 1800;

/** Run every due close within seconds of its instant, from the server's own clock. */
export function startScheduler(): void {
  let ticks = 0;
  setInterval(() => {
    if (!database.ready) return;
    ticks += 1;
    void serialized(() => runDueCloses(new Date())).catch((error: unknown) => console.error("scheduled close failed", error));
    if (ticks % PURGE_EVERY_TICKS === 0) void forgetOld(pool).catch((error: unknown) => console.error("key purge failed", error));
  }, TICK_MS).unref();
}
