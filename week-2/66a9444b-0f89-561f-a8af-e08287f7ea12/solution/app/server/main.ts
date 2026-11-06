// Kerf Frequencies server: applies the schema and seed, then serves the API and the built browser app.
import { createServer } from "node:http";
import { loadAppSecret } from "./auth.ts";
import { config } from "./config.ts";
import { runScriptLocked } from "./db/index.ts";
import { SCHEMA } from "./db/schema.ts";
import { handleRequest } from "./http.ts";
import { seed } from "./seed.ts";
import { kick, startWorker } from "./worker.ts";
import "./domain/accounts.ts";
import "./domain/admin.ts";
import "./domain/audit.ts";
import "./domain/checkout.ts";
import "./domain/curation.ts";
import "./domain/door.ts";
import "./domain/entries.ts";
import "./domain/group.ts";
import "./domain/health.ts";
import "./domain/invoices.ts";
import "./domain/orders.ts";
import "./domain/programme.ts";
import "./domain/proofs.ts";
import "./domain/reconciliation.ts";
import "./domain/refunds.ts";
import "./domain/seats.ts";
import "./domain/signedLinks.ts";
import "./domain/transfers.ts";
import "./domain/vouchers.ts";

await runScriptLocked("kerf-schema", SCHEMA);
await loadAppSecret();
await seed();

const server = createServer((req, res) => {
  void handleRequest(req, res).then(() => {
    if (req.method !== "GET" && req.method !== "HEAD") kick();
  });
});
server.keepAliveTimeout = 5000;
server.listen(config.port, "0.0.0.0", () => console.log(`Kerf Frequencies listening on 0.0.0.0:${config.port}`));
startWorker();

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)).closeAllConnections());
