/** The server: one origin for the API and both consoles, started before its dependencies. */

import { createServer } from "node:http";
import { config } from "./config.js";
import { applySchema, startChangeNotices } from "./db/pool.js";
import { handleRequest } from "./routes/index.js";
import { makeContext } from "./http/context.js";
import { ensureBucket } from "./services/storage.js";
import { ensureIndex } from "./services/search.js";
import { ensureBroker } from "./services/broker.js";
import { ensureCatalogue } from "./services/billing.js";
import { ensureEventTypes } from "./services/webhooks.js";
import { startConsumers } from "./consumers.js";
import { startOutboxRelay } from "./domain/outbox.js";
import { runSearchCatchUp } from "./domain/searchWrites.js";
import { ensureSeed } from "./seed.js";

const server = createServer((request, response) => {
  response.setHeader("x-content-type-options", "nosniff");
  void handleRequest(makeContext(request, response));
});

server.headersTimeout = 65_000;
server.requestTimeout = 0;

async function prepareDependencies(): Promise<void> {
  const steps: (() => Promise<unknown>)[] = [
    ensureBucket,
    ensureIndex,
    ensureBroker,
    ensureEventTypes,
    ensureCatalogue,
    ensureSeed,
    runSearchCatchUp,
  ];
  for (const step of steps) {
    try {
      await step();
    } catch {
      /* the next sweep tries this dependency again */
    }
  }
}

async function main(): Promise<void> {
  await applySchema();
  await startChangeNotices();
  server.listen(config.port, "0.0.0.0");
  startConsumers();
  startOutboxRelay();
  void prepareDependencies();
  setInterval(() => {
    void prepareDependencies();
  }, config.dependencyRetrySeconds * 1000).unref();
}

void main().catch((error: unknown) => {
  process.stderr.write(`cannot start: ${String(error)}\n`);
  process.exit(1);
});
