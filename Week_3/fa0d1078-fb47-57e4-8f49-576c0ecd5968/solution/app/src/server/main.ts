import { config } from "./config";
import { migrateUntilReady } from "./db";
import { createServer } from "./http";
import { startLive } from "./live";

startLive();
void migrateUntilReady();
createServer().listen(config.port, "0.0.0.0", () => {
  console.log(`Seam listening on ${config.port}`);
});
