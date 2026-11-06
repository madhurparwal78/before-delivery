import { createServer } from "node:http";
import { config } from "./config.js";
import { connectWithRetry } from "./db.js";
import { dispatch } from "./http/router.js";
import { retrySealing } from "./domain/certificates.js";
import { deliverOutbox } from "./domain/outbox.js";
import { loadProvider } from "./domain/provider.js";
import { routes } from "./routes.js";
import { migrateAndSeed } from "./seed.js";
import { serveStatic } from "./static.js";

const report = (what: string) => (error: unknown) => console.error(`${what}:`, error instanceof Error ? error.message : String(error));

await connectWithRetry();
await migrateAndSeed();
await loadProvider();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://app.invalid");
  const work = url.pathname === "/api" || url.pathname.startsWith("/api/")
    ? dispatch(routes, req, res, url)
    : serveStatic(url.pathname, res, req.method === "HEAD");
  work.catch((error: unknown) => {
    report(`${req.method ?? "GET"} ${url.pathname}`)(error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "internal_error" }));
  });
});

server.listen(config.port, "0.0.0.0", () => console.log(`Credwell listening on port ${config.port}`));

setInterval(() => deliverOutbox().catch(report("outbox")), 1000);
setInterval(() => retrySealing().catch(report("seal retry")), config.clock.sealRetryMs);
retrySealing().catch(report("seal retry"));
