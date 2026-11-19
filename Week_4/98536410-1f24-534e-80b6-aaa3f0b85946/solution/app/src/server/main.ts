import http from "node:http";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { purgeExpiredSessions } from "./auth.js";
import { handleApi } from "./http.js";
import { sweepHolds } from "./holds.js";
import { startMailer } from "./mailer.js";
import { handlePage, loadPages } from "./pages.js";
import { registerRoutes } from "./routes.js";
import { startStorageMonitor } from "./storage.js";
import { promoteDueHours } from "./shops.js";

let ready = false;

registerRoutes();
await loadPages();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const work = url.pathname === "/api" || url.pathname.startsWith("/api/") ? handleApi(req, res, url, ready) : handlePage(req, res, url);
  work.catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ code: "internal_error" }));
  });
});

server.keepAliveTimeout = 65_000;
server.listen(config.port, "0.0.0.0", () => console.log(`Tramela Estate listening on ${config.port}`));

async function prepare(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      break;
    } catch (error) {
      console.error("waiting for PostgreSQL:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await startStorageMonitor();
  startMailer();
  setInterval(() => void sweepHolds(new Date()).catch(() => undefined), config.holdSweepSeconds * 1000).unref();
  setInterval(() => void Promise.all([purgeExpiredSessions(), promoteDueHours(new Date())]).catch(() => undefined), 60_000).unref();
  ready = true;
}

await prepare();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
