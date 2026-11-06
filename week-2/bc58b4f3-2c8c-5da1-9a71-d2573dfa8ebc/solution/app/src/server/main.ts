import { createServer } from "node:http";
import { registerAssignmentRoutes } from "./assignments.js";
import { registerAuthRoutes } from "./auth.js";
import { registerBillingRoutes, startBillingRetry } from "./billing.js";
import { config } from "./config.js";
import { registerCoverageRoutes } from "./coverage.js";
import { pool, prepareDatabase } from "./db.js";
import { handleApi, openRoute } from "./http.js";
import { startOutboxSender } from "./mail.js";
import { registerOrgRoutes } from "./org.js";
import { registerSeatRoutes } from "./seats.js";
import { serveClient } from "./static.js";

openRoute("GET", "/api/health", async () => {
  await pool.query("SELECT 1");
  return { status: 200, json: { status: "ok" } };
});
registerAuthRoutes();
registerAssignmentRoutes();
registerSeatRoutes();
registerCoverageRoutes();
registerBillingRoutes();
registerOrgRoutes();

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

const server = createServer((req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  const url = new URL(req.url ?? "/", "http://teamseat.invalid");
  const work = url.pathname.startsWith("/api/") || url.pathname.startsWith("/files/")
    ? handleApi(req, res, url)
    : serveClient(res, url.pathname);
  work.catch((error: unknown) => {
    console.error(error);
    res.destroy();
  });
});

async function start(): Promise<void> {
  for (;;) {
    try {
      await prepareDatabase();
      break;
    } catch (error) {
      console.warn(`Waiting for Postgres: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  startOutboxSender();
  startBillingRetry();
  server.listen(config.port, "0.0.0.0", () => console.log(`Teamseat listening on 0.0.0.0:${config.port}`));
}

void start();
