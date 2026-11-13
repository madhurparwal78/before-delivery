import { config } from "./config";
import { canReachDatabase, pool } from "./db";
import { setReady, startServer } from "./http";
import { startJobs } from "./jobs";
import { registerRoutes } from "./routes";
import { migrateAndSeed } from "./seed";

registerRoutes();
startServer(config.port);

async function boot(): Promise<void> {
  for (;;) {
    if (await canReachDatabase()) {
      try {
        await migrateAndSeed();
        break;
      } catch (error) {
        console.error("migration failed, retrying", error instanceof Error ? error.message : error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  setReady(true);
  startJobs();
}

void boot();

process.on("unhandledRejection", (reason) => console.error("unhandled rejection", reason instanceof Error ? reason.message : reason));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void pool.end().finally(() => process.exit(0));
  });
}
