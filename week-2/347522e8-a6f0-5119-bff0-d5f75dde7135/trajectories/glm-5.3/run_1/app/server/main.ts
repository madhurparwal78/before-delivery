import { applySchema, waitForDatabase, withTx, type Tx } from "./db.js";
import { ensureBucket } from "./storage.js";
import { runSeed } from "./seed.js";
import { startOutbox, startComplianceScan, startHoldExpiry } from "./loops.js";
import { handleRequest, startHttpServer } from "./http-server.js";

// Route registration happens as an import side effect.
import "./routes/auth.js";
import "./routes/renters.js";
import "./routes/documents.js";
import "./routes/bookings.js";
import "./routes/stations.js";
import "./routes/ops.js";
import "./routes/purchases.js";
import "./routes/share.js";

const start = async (): Promise<void> => {
  await waitForDatabase();
  await applySchema();
  await withTx(async (tx: Tx) => {
    await runSeed(tx);
  });
  await ensureBucket();
  startOutbox();
  startComplianceScan();
  startHoldExpiry();
  startHttpServer(handleRequest);
};

void start();
