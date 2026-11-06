import { createServer } from "node:http";
import { config } from "./config.js";
import { pool, tx } from "./db.js";
import { internalError, sendError } from "./http/errors.js";
import { Pages } from "./http/pages.js";
import { Router } from "./http/router.js";
import { pages, routes } from "./routes/index.js";
import { SCHEMA } from "./schema.js";
import { seed, syncSeedFiles } from "./seed.js";
import { startOutbox } from "./services/mail.js";

const START_LOCK = 4_173_001;
const router = new Router(routes);
const site = new Pages(pages);
let ready = false;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://app.invalid");
  if (url.pathname === "/api/health") {
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: ready ? "ok" : "starting" }));
    return;
  }
  const work = url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/") ? router.handle(req, res, url) : site.serve(req, res, url);
  work.catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) sendError(res, internalError());
  });
});

/** Applies the schema and seed under one advisory lock, retrying every 2 seconds until Postgres answers. */
async function boot(): Promise<void> {
  for (;;) {
    try {
      await tx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1)", [START_LOCK]);
        await client.query(SCHEMA);
        await seed(client);
      });
      break;
    } catch (error) {
      console.error("waiting for postgres:", (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  ready = true;
  startOutbox();
  while (!(await syncSeedFiles())) await new Promise((resolve) => setTimeout(resolve, 30_000));
}

server.listen(config.port, "0.0.0.0", () => console.log(`plumbline listening on 0.0.0.0:${config.port}`));
void boot();

process.on("SIGTERM", () => {
  server.close();
  void pool.end().finally(() => process.exit(0));
});
