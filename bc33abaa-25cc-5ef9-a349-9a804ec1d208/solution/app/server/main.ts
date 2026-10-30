// Serve: schema and seed (retried until PostgreSQL answers), the event relay, the scheduler, then the listener.
import { createServer } from "node:http";
import { config } from "./config.js";
import { applySchema } from "./db.js";
import { listen } from "./events.js";
import { handle } from "./http.js";
import { fallback } from "./pages.js";
import { startScheduler } from "./scheduler.js";
import { seed } from "./seed.js";
import "./routes/account.js";
import "./routes/members.js";
import "./routes/tokens.js";
import "./routes/scenes.js";
import "./routes/versions.js";
import "./routes/billing.js";

async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await seed();
      return;
    } catch (error) {
      console.error("waiting for PostgreSQL:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

await prepareDatabase();
await listen();
startScheduler();
const server = createServer((req, res) => { void handle(req, res, fallback); });
server.listen(config.port, "0.0.0.0", () => console.log(`Orrery Studio listening on 0.0.0.0:${config.port}`));
