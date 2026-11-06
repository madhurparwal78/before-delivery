// Start-up: wait for Postgres, apply schema and seed, listen, then reach the object store and the
// alert queue in the background so an unreachable store or mail sink never stops the server.

import { createServer } from "node:http";
import { deliverQueuedAlerts } from "./alerts.js";
import { config } from "./config.js";
import { waitForDatabase } from "./db.js";
import { createHandler } from "./http.js";
import { accessRoutes } from "./routes/access.js";
import { figureRoutes } from "./routes/figures.js";
import { projectRoutes } from "./routes/projects.js";
import { readingRoutes } from "./routes/readings.js";
import { sealRoutes } from "./routes/seal.js";
import { sessionRoutes } from "./routes/session.js";
import { applySchemaAndSeed } from "./seed.js";
import { ensureBucket } from "./storage.js";

const ALERT_RETRY_MS = 30_000;

await waitForDatabase();
await applySchemaAndSeed();

const server = createServer(createHandler([
  ...sessionRoutes, ...projectRoutes, ...sealRoutes, ...readingRoutes, ...figureRoutes, ...accessRoutes,
]));
server.listen(config.port, "0.0.0.0", () => console.log("Fluxseal is listening"));

ensureBucket().catch(() => console.warn("evidence storage is unreachable; seals will answer 503 until it returns"));
void deliverQueuedAlerts();
setInterval(() => void deliverQueuedAlerts(), ALERT_RETRY_MS);
