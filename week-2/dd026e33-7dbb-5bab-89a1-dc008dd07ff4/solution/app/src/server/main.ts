// Lacquer's server: applies the schema and seed, then listens on 0.0.0.0 and runs the provider queue.
import { createServer } from "node:http";
import { config } from "./config.js";
import { meOf } from "./account.js";
import { resolveSession } from "./auth.js";
import { pool } from "./db.js";
import { createApiHandler, serveStatic } from "./http.js";
import { startQueue } from "./queue.js";
import { ROUTES } from "./routes.js";
import { migrateAndSeed } from "./seed.js";

async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await migrateAndSeed();
      return;
    } catch (error) {
      console.error(`database not ready: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

await prepareDatabase();
const api = createApiHandler(ROUTES);
/** The signed-in user for the first render of an app page; null without a live session. */
const pageData = async (req: Parameters<typeof resolveSession>[0]): Promise<unknown> => {
  try {
    return await meOf(pool, await resolveSession(req));
  } catch {
    return null;
  }
};
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const handled = url.pathname === "/api" || url.pathname.startsWith("/api/") ? api(req, res, url) : serveStatic(req, res, url, pageData);
  handled.catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500).end();
  });
});
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Lacquer listening on port ${config.port}`);
});
startQueue();
