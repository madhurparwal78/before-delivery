import { createServer } from "node:http";
import { config } from "./config.js";
import { handleApi } from "./http.js";
import { migrateAndSeed } from "./migrate.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerBookingRoutes } from "./routes/bookings.js";
import { registerInterpreterRoutes } from "./routes/interpreters.js";
import { registerMaterialRoutes } from "./routes/materials.js";
import { registerSessionRoutes } from "./routes/session.js";
import { serveStatic } from "./static.js";
import { kickWorkers, startWorkers } from "./workers.js";

const RETRY_MS = 3_000;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Postgres may not be up yet: keep trying until the schema and seed are in place. */
async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await migrateAndSeed();
      return;
    } catch (error) {
      console.error(`database not ready: ${error instanceof Error ? error.message : String(error)}`);
      await pause(RETRY_MS);
    }
  }
}

registerSessionRoutes();
registerBookingRoutes();
registerMaterialRoutes();
registerInterpreterRoutes();
registerBillingRoutes();

await prepareDatabase();

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://relayline.invalid").pathname;
  const handled = pathname === "/api" || pathname.startsWith("/api/") ? handleApi(request, response) : serveStatic(request, response);
  handled.catch((error: unknown) => {
    console.error(error);
    response.destroy();
  });
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Relayline serving on ${config.port}`);
  startWorkers();
  kickWorkers();
});
