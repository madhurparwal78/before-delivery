// Furrowbook server: one process serving the API and the browser app on APP_PUBLIC_PORT.
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createDb, prepareDatabase, waitForDatabase } from "./db.js";
import { createHandler } from "./http.js";
import { conflictRoutes } from "./routes/conflicts.js";
import { exportRoutes } from "./routes/exports.js";
import { sessionRoutes } from "./routes/session.js";
import { shareRoutes } from "./routes/share.js";
import { stationRoutes } from "./routes/station.js";
import { versionRoutes } from "./routes/versions.js";
import { workbookRoutes } from "./routes/workbooks.js";
import { seed } from "./seed.js";
import { Mailer } from "./services/mailer.js";
import { StatusMonitor } from "./services/status.js";
import { Storage } from "./services/storage.js";
import { startWorkers } from "./workers.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
await waitForDatabase(db);
await prepareDatabase(db, seed);

const storage = new Storage(config.s3);
const mailer = new Mailer(config.smtp);
const status = new StatusMonitor(storage, mailer);
status.start();
const workers = startWorkers(db, storage, mailer, status);

const services = { db, storage, status, workers };
sessionRoutes(services);
workbookRoutes(services);
conflictRoutes(services);
versionRoutes(services);
exportRoutes(services);
shareRoutes(services);
stationRoutes(services);

const clientDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "client");
createServer(createHandler(db, clientDir)).listen(config.port, "0.0.0.0", () => {
  console.log(`Furrowbook listening on 0.0.0.0:${config.port}`);
});
