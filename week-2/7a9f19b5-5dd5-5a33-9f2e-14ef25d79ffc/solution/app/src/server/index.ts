import { createServer } from "node:http";
import { adminRoutes } from "./admin.js";
import { authRoutes } from "./auth.js";
import { catalogueRoutes } from "./catalogue.js";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { createApi, json, serveStatic, type Route } from "./http.js";
import { startLive } from "./live.js";
import { newsletterRoutes } from "./newsletter.js";
import { orderRoutes } from "./orders.js";
import { placementEvent, projectRoutes } from "./projects.js";
import { seed } from "./seed.js";
import { startShareWorker } from "./shares.js";
import { specSheetRoutes } from "./specSheets.js";

const health: Route = {
  method: "GET",
  path: "/api/health",
  access: "public",
  handler: async () => json(200, { status: "ok" }),
};

const handleApi = createApi([
  health,
  ...authRoutes,
  ...catalogueRoutes,
  ...specSheetRoutes,
  ...orderRoutes,
  ...projectRoutes,
  ...adminRoutes,
  ...newsletterRoutes,
]);

await migrate(seed);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://lightfall.local");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) void handleApi(req, res, url);
  else serveStatic(req, res, url);
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Lightfall listening on port ${config.port}`);
  // Providers that are unreachable now are retried on their own cadence; boot never waits for them.
  startLive(placementEvent);
  startShareWorker();
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  // Live event streams never end on their own, so stop at once rather than waiting for them to drain.
  process.on(signal, () => process.exit(0));
}
