// Spanwise server: one origin for the built frontend and /api.
import { createServer } from "node:http";
import { config } from "./config.js";
import { applySchema } from "./db.js";
import { ApiError } from "./http/errors.js";
import { createHandler, errorReply, writeReply } from "./http/pipeline.js";
import { serveStatic } from "./http/static.js";
import { monitor } from "./monitor.js";
import { startOutboxWorker } from "./outbox.js";
import { assetRoutes } from "./routes/assets.js";
import { corridorRoutes } from "./routes/corridors.js";
import { findingRoutes } from "./routes/findings.js";
import { reviewRoutes } from "./routes/review.js";
import { sessionRoutes } from "./routes/session.js";
import { setRoutes } from "./routes/sets.js";
import { seed, storeSeedFixtures } from "./seed.js";

const handle = createHandler([...sessionRoutes, ...corridorRoutes, ...assetRoutes, ...setRoutes, ...findingRoutes, ...reviewRoutes], serveStatic);

const ready = (async () => {
  await applySchema();
  await seed();
  monitor.onStorageOk(() => void storeSeedFixtures());
  monitor.start();
  startOutboxWorker();
})();
ready.catch((error: unknown) => {
  console.error("startup failed:", error);
  process.exit(1);
});

const server = createServer((req, res) => {
  const healthCheck = req.url === "/api/health" && req.method === "GET";
  const work = healthCheck ? handle(req, res) : ready.then(() => handle(req, res));
  work.catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) void writeReply(res, errorReply(new ApiError(500, "internal_error", "Something went wrong.")));
  });
});
server.requestTimeout = 0;
server.listen(config.port, "0.0.0.0", () => console.log(`Spanwise listening on 0.0.0.0:${config.port}`));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
