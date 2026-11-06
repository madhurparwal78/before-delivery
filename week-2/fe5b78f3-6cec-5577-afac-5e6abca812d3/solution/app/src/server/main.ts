// One process serves the API and the web app. It listens at once and reports healthy once the database is ready.
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import type { App } from "./app.js";
import { loadConfig } from "./config.js";
import { createClock } from "./domain/clock.js";
import { type Route, handleApi } from "./http/api.js";
import { ApiError, sendError } from "./http/errors.js";
import { serveStatic } from "./http/static.js";
import { startJobs } from "./jobs.js";
import { accountRoutes } from "./routes/accounts.js";
import { bookingRoutes } from "./routes/bookings.js";
import { cancellationRoutes } from "./routes/cancellations.js";
import { journeyRoutes } from "./routes/journeys.js";
import { createKillBill } from "./services/killbill.js";
import { createObjectStore } from "./services/s3.js";
import { createMailer } from "./services/smtp.js";
import { loadCatalog, migrate } from "./store/schema.js";

pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

const config = loadConfig();
const clock = createClock(config.clock.start, config.clock.rate);
const db = new pg.Pool({ connectionString: config.databaseUrl, max: 30, connectionTimeoutMillis: 10_000 });
db.on("error", (error) => console.error(`postgres: ${error.message}`));
const routes: Route[] = [...journeyRoutes, ...accountRoutes, ...bookingRoutes, ...cancellationRoutes];
let app: App | undefined;

const server = createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    if (!app) return sendError(res, new ApiError(503, "starting", "Pakka is starting. Try again in a moment."));
    if (url.pathname === "/api/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok" }));
    }
    return void handleApi(app, routes, req, res, url);
  }
  serveStatic(res, url.pathname).catch((error: unknown) => sendError(res, error));
});
server.listen(config.port, "0.0.0.0", () => console.log(`Pakka Rail listening on 0.0.0.0:${config.port}`));

async function boot(): Promise<void> {
  for (;;) {
    try {
      await migrate(db);
      break;
    } catch (error) {
      console.error(`database not ready: ${String(error)}`);
      await sleep(2000);
    }
  }
  const ready: App = {
    config,
    db,
    clock,
    catalog: await loadCatalog(db),
    killbill: createKillBill(config.killbill),
    store: createObjectStore(config.s3),
    mailer: createMailer(config.smtp),
    nudge: () => undefined,
  };
  ready.nudge = startJobs(ready);
  app = ready;
}

void boot();
