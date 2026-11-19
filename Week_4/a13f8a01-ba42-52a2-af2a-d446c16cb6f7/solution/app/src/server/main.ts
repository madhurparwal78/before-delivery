import { pool, applySchema, waitForDatabase } from "./db.js";
import { ensureStarters, writeStarterVersions } from "./bootstrap.js";
import { startServer } from "./http.js";
import { purgeIdempotency } from "./idempotency.js";
import { drainOutbox } from "./outbox.js";
import { purgeRenders } from "./renders.js";
import { allRoutes } from "./routes.js";
import { mirrorShelf } from "./shelf.js";
import { storageAnswers } from "./storage.js";

const STORAGE_CHECK_MS = 2000;
const OUTBOX_CHECK_MS = 5000;
const HOUSEKEEPING_MS = 60000;

let storageSynced = false;

async function reconcileStorage(): Promise<void> {
  if (!(await storageAnswers())) {
    storageSynced = false;
    return;
  }
  if (storageSynced) return;
  try {
    await mirrorShelf();
    await writeStarterVersions();
    storageSynced = true;
  } catch {
    storageSynced = false;
  }
}

async function housekeeping(): Promise<void> {
  await purgeRenders();
  await purgeIdempotency();
  await pool.query("DELETE FROM sessions WHERE created_at < now() - interval '30 days'");
}

await waitForDatabase();
await applySchema();
await ensureStarters();
const server = startServer(allRoutes());

setInterval(() => void reconcileStorage(), STORAGE_CHECK_MS).unref();
setInterval(() => void drainOutbox(), OUTBOX_CHECK_MS).unref();
setInterval(() => void housekeeping().catch(() => undefined), HOUSEKEEPING_MS).unref();
void reconcileStorage();

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
});
