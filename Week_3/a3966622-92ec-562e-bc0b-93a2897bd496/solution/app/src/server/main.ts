// Serves Slackwater: one embedded store per port, the API, the built client and the step worker.
import path from "node:path";
import type { App } from "./app.js";
import { loadConfig } from "./config.js";
import { Router, startServer } from "./http.js";
import { ServiceMonitor } from "./providers/health.js";
import { KillBill } from "./providers/killbill.js";
import { ObjectStore } from "./providers/s3.js";
import { Mailer } from "./providers/smtp.js";
import { billingRoutes } from "./routes/billing.js";
import { evidenceRoutes } from "./routes/evidence.js";
import { moveRoutes } from "./routes/moves.js";
import { sessionRoutes } from "./routes/session.js";
import { stationRoutes } from "./routes/station.js";
import { seed } from "./seed.js";
import { startSteps } from "./steps.js";
import { Store } from "./store.js";

const config = loadConfig();
const store = new Store(config.appRoot, config.port);
const killbill = new KillBill(config.killbill);
const objects = new ObjectStore(config.s3);
const mailer = new Mailer(config.smtp);
const app: App = { store, config, killbill, objects, mailer, services: new ServiceMonitor(killbill, objects, mailer) };

seed(app, Date.now());

const router = new Router();
stationRoutes(router, app);
sessionRoutes(router, app);
moveRoutes(router, app);
evidenceRoutes(router, app);
billingRoutes(router, app);

startServer(store, router, path.join(config.appRoot, "dist", "client"), config.port);
startSteps(app);
console.log(`Slackwater serving on 0.0.0.0:${config.port}`);
