import { query } from "./db.js";
import { purgeDue } from "./references.js";
import { SearchUnavailable, catchUp, ensureIndex, rebuildIndex } from "./search.js";
import { setService } from "./services.js";
import { renderQueued } from "./sheets.js";
import { seedIfEmpty } from "./seed.js";
import { printingIsUp } from "./printing.js";
import { ensureBucket } from "./storage.js";

const STATUS_CHECK_MS = 3000;
const PURGE_SWEEP_MS = 2000;
const SHEET_POLL_MS = 1000;
const SEED_RETRY_MS = 2000;
const RECORD_SWEEP_MS = 10 * 60 * 1000;

/** Runs `work` every `ms` of real time, never overlapping itself; a failure waits for the next turn. */
function every(ms: number, work: () => Promise<void>): void {
  let running = false;
  const turn = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await work();
    } catch (error) {
      console.error(error);
    } finally {
      running = false;
    }
  };
  void turn();
  setInterval(() => void turn(), ms);
}

async function checkStorage(): Promise<void> {
  try {
    await ensureBucket();
    setService("storage", "up");
  } catch {
    setService("storage", "down");
  }
}

async function checkPrinting(): Promise<void> {
  setService("printing", (await printingIsUp()) ? "up" : "down");
}

/** Index check: recreates a lost index, rebuilds it from Postgres, then applies recorded updates. */
async function checkSearch(): Promise<void> {
  try {
    if (await ensureIndex()) {
      setService("search", "down");
      await rebuildIndex();
    }
    await catchUp();
    setService("search", "up");
  } catch (error) {
    if (!(error instanceof SearchUnavailable)) console.error(error);
    setService("search", "down");
  }
}

/** Starts the checks and the deferred work: status, seed, sheet rendering, purge sweep, catch-up. */
export function startBackgroundWork(): void {
  every(STATUS_CHECK_MS, async () => {
    await Promise.all([checkStorage(), checkPrinting(), checkSearch()]);
  });
  every(SEED_RETRY_MS, seedUntilDone);
  every(SHEET_POLL_MS, renderQueued);
  every(PURGE_SWEEP_MS, purgeDue);
  every(RECORD_SWEEP_MS, async () => {
    await query("DELETE FROM idempotency_record WHERE expires_at < $1", [new Date()]);
  });
}

let seeded = false;
async function seedUntilDone(): Promise<void> {
  if (seeded) return;
  await seedIfEmpty();
  seeded = true;
}
