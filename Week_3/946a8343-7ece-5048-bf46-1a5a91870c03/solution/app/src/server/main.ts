import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySchema, pool } from "./db.ts";
import { loadStaticAssets, startServer } from "./http.ts";
import { buildRouter } from "./routes.ts";
import { attachLive } from "./live.ts";
import { startBackgroundLoops } from "./deadlines.ts";
import { storage } from "./s3.ts";
import { seedDemoInstance } from "./admin/index.ts";

process.on("unhandledRejection", (reason) => console.error("unhandled rejection", reason));
process.on("uncaughtException", (error) => console.error("uncaught exception", error));

loadStaticAssets(join(dirname(fileURLToPath(import.meta.url)), "public"));
const server = startServer(buildRouter());
attachLive(server);

// The server listens first; Postgres may come up later. Until Postgres answers the health check says `starting`; once it does, it waits for the schema and the demo instance.
async function initialise(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      await applySchema();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await storage.ensureBucket();
  await seedDemoInstance();
  startBackgroundLoops();
}

initialise().catch((error: unknown) => console.error("initialisation failed", error));
