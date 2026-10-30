// Shedline server: waits for PostgreSQL, prepares the schema and seed rows, then serves the API and the
// browser app on one origin and starts the background work.

import { createServer } from "node:http";
import { config } from "./config.js";
import { waitForDatabase } from "./db.js";
import { loadLibrary } from "./domain/library.js";
import { loadCursorSecret } from "./domain/lists.js";
import { handleApi } from "./http/api.js";
import { serveStatic } from "./http/static.js";
import { describeError } from "./log.js";
import { migrateAndSeed } from "./schema.js";
import { startWorker } from "./worker.js";

await waitForDatabase();
await migrateAndSeed();
await loadLibrary();
await loadCursorSecret();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://shedline.invalid");
  const work = url.pathname === "/api" || url.pathname.startsWith("/api/") ? handleApi(req, res, url) : serveStatic(req, res, url);
  work.catch((error: unknown) => {
    console.error(`unhandled request failure: ${describeError(error)}`);
    if (!res.headersSent) res.writeHead(500).end();
  });
});
server.listen(config.port, "0.0.0.0", () => console.log(`Shedline listening on port ${config.port}`));
startWorker();
