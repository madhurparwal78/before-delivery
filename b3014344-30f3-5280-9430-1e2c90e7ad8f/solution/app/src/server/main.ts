import http from "node:http";
import { handleApi, isApi } from "./api";
import { config } from "./config";
import { migrate } from "./db";
import { serveAsset, servePage } from "./pages";
import { seedLedger } from "./seed";
import { startWorkers } from "./workers";

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (isApi(url.pathname)) {
    void handleApi(req, res, url);
    return;
  }
  if ((req.method === "GET" || req.method === "HEAD") && serveAsset(res, url.pathname)) return;
  servePage(req, res, url).catch((error: unknown) => {
    console.error(`page ${url.pathname} failed:`, error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Something went wrong on our side.");
  });
});

/** The schema and the seeded sign-ins are applied on serve; until Postgres answers, the app keeps retrying. */
async function prepare(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      await seedLedger();
      startWorkers();
      return;
    } catch (error) {
      console.warn(`[schema] waiting for Postgres: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

// The port opens once the ledger is ready, or after a bounded wait so health answers with Postgres down.
await Promise.race([prepare(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
server.listen(config.port, "0.0.0.0", () => console.log(`Pampero Ledger listening on 0.0.0.0:${config.port}`));

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => process.exit(0));
