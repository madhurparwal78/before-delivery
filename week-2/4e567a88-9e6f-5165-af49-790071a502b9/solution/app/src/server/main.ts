// Starts Lumenfold Dispatch: the HTTP server first (so the health check answers whatever the state of the
// dependencies), then the schema and seed, then the dependency watch and the background workers.

import { reason } from "./log";
import { createServer } from "node:http";
import { config } from "./config";
import { pool } from "./db";
import { currentPolicy } from "./domain/policy";
import { createHandler } from "./http";
import { migrate } from "./store";
import { onRecovery, watchDependencies } from "./services/status";
import { nudgeDispatcher, startDispatcher } from "./workers/dispatcher";
import { nudgeTopups, startUpkeep } from "./workers/upkeep";
import { startWebhooks } from "./workers/webhooks";
import "./routes/session";
import "./routes/models";
import "./routes/jobs";
import "./routes/assets";
import "./routes/finance";
import "./routes/policy";
import "./routes/webhooks";

const MIGRATE_RETRY_MS = 2_000;

const server = createServer(createHandler(async () => (await currentPolicy(pool)).timezone));
server.listen(config.port, "0.0.0.0", () => console.log(`Lumenfold Dispatch listening on port ${config.port}`));

async function prepare(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      return;
    } catch (error) {
      console.error(`database not ready (${reason(error)}); retrying`);
      await new Promise((resolve) => setTimeout(resolve, MIGRATE_RETRY_MS));
    }
  }
}

await prepare();
watchDependencies();
onRecovery(nudgeDispatcher);
onRecovery(nudgeTopups);
startDispatcher();
startWebhooks();
startUpkeep();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
