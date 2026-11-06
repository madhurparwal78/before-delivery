import { createServer } from "node:http";
import { config } from "./config.ts";
import { migrate } from "./db.ts";
import { handleApi } from "./http.ts";
import { ensureCatalogue, startBillingProbe } from "./killbill.ts";
import { startOutbox } from "./outbox.ts";
import { handlePage } from "./pages.ts";
import { markReady } from "./routes.ts";
import { seed } from "./seed.ts";

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", config.publicUrl);
  const handler = url.pathname.startsWith("/api/") ? handleApi(req, res, url) : handlePage(req, res, url);
  handler.catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

// Keep idle connections open longer than client pools reuse them, so a reused socket is never closed mid-request.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(config.port, "0.0.0.0");

/** Postgres is required: retry every 2 seconds until the schema is in place, then start the workers. */
async function boot(): Promise<void> {
  for (;;) {
    try {
      await migrate(seed);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  markReady();
  startOutbox();
  ensureCatalogue();
  startBillingProbe();
}

void boot();
