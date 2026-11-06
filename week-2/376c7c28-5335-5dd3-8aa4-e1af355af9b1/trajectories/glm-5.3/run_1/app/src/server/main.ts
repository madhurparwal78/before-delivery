import { config, loadConfig } from "./config";
import { initClock } from "./clock";
import { startServer, markSchemaReady } from "./http/server";
import { applySchema } from "./schema";
import { seedIfEmpty, ensureSeedPhotos } from "./seed";
import { startBackgroundWork } from "./billing/settler";
import { sweepOnce } from "./billing/storage";
import { pool } from "./db";

async function main(): Promise<void> {
  const cfg = loadConfig();
  initClock(cfg.appClockStart);
  await import("./api/index");
  // Listen at once; health answers 503 {"status":"starting"} until Postgres answers
  // and the schema is applied. Kill Bill and MinIO are not needed to be healthy.
  await startServer();
  void prepare();
}

async function prepare(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      break;
    } catch (e) {
      console.error("schema apply failed; retrying", e);
      await sleep(2000);
    }
  }
  for (;;) {
    try {
      await seedIfEmpty();
      break;
    } catch (e) {
      console.error("seed failed; retrying", e);
      await sleep(2000);
    }
  }
  markSchemaReady();
  startBackgroundWork({ sweep: sweepOnce });
  // Seeded photos need the bucket; retry until storage answers.
  void (async () => {
    for (let i = 0; i <60; i++) {
      try {
        await ensureSeedPhotos();
        return;
      } catch {
        await sleep(30000);
      }
    }
  })();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});

export { config };
