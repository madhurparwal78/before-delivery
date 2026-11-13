// Starts one process serving the browser app and the API on 0.0.0.0. The schema is applied
// first; the backing services may be down at boot and are only needed by the features using them.

import http from "node:http";
import { settleExpiredHolds } from "./bookings.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { SECURITY_HEADERS } from "./headers.js";
import { deliverSoon } from "./mail.js";
import { sweepNotices } from "./notices.js";
import { recoverAttempts } from "./packs.js";
import { serveApi } from "./pipeline.js";
import { routes } from "./routes.js";
import { applySchema } from "./schema.js";
import { serveStatic } from "./static.js";

async function untilSchema(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await applySchema();
      return;
    } catch (error) {
      if (attempt >= 60) throw error;
      console.error(`schema not applied yet (attempt ${attempt}):`, error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

function every(seconds: number, task: () => Promise<void>, name: string): void {
  let running = false;
  const run = (): void => {
    if (running) return;
    running = true;
    task().catch((error: unknown) => console.error(`${name} failed:`, error)).finally(() => {
      running = false;
    });
  };
  run();
  setInterval(run, seconds * 1000).unref();
}

await untilSchema();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://stationhouse.invalid");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    void serveApi(routes, req, res, url);
  } else if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(url.pathname, res);
  } else {
    res.writeHead(404, SECURITY_HEADERS).end();
  }
});
server.requestTimeout = 120_000;

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Stationhouse listening on 0.0.0.0:${config.port} (${config.timeZone})`);
  every(5, () => settleExpiredHolds(db), "hold expiry");
  every(10, async () => deliverSoon(), "mail delivery");
  every(10, recoverAttempts, "purchase recovery");
  every(config.expirySweepSeconds, async () => {
    await sweepNotices();
    deliverSoon();
  }, "expiry sweep");
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
