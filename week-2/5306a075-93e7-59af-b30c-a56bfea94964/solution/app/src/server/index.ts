// Boot: wait for PostgreSQL, apply the schema and seed under one advisory lock, start the shared
// background passes, then serve the API and the client on 0.0.0.0.
import { createServer } from "node:http";
import { config } from "./config.js";
import { db, waitForDatabase } from "./db.js";
import { errorReply, Router, send } from "./http/router.js";
import { serveClient } from "./http/static.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { companyRoutes } from "./routes/companies.js";
import { exportRoutes } from "./routes/exports.js";
import { featureRoutes } from "./routes/features.js";
import { importRoutes } from "./routes/imports.js";
import { insightRoutes } from "./routes/insights.js";
import { invitationRoutes } from "./routes/invitations.js";
import { noteRoutes } from "./routes/notes.js";
import { roadmapRoutes } from "./routes/roadmap.js";
import { sessionRoutes } from "./routes/session.js";
import { shareLinkRoutes } from "./routes/shareLinks.js";
import { SCHEMA_STATEMENTS } from "./schema.js";
import { seedIfEmpty } from "./seed.js";
import { startWorkers } from "./services/workers.js";
import { notFound } from "./http/errors.js";

await waitForDatabase();
await db.transaction(async (tx) => {
  await tx.query("SELECT pg_advisory_xact_lock(4173)");
  for (const statement of SCHEMA_STATEMENTS) await tx.query(statement);
  await seedIfEmpty(tx);
});
startWorkers();

const router = new Router();
for (const register of [sessionRoutes, noteRoutes, attachmentRoutes, insightRoutes, featureRoutes, roadmapRoutes, shareLinkRoutes, companyRoutes, importRoutes, exportRoutes, invitationRoutes]) {
  register(router);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://app.invalid");
  void (async () => {
    try {
      if (await router.handle(req, res, url)) return;
      if (url.pathname.startsWith("/api/")) {
        for await (const chunk of req) void chunk;
        send(res, errorReply(notFound()));
        return;
      }
      await serveClient(req, res, url);
    } catch (error) {
      if (!res.headersSent) send(res, errorReply(error));
    }
  })();
});
server.requestTimeout = 120_000;
server.listen(config.port, "0.0.0.0", () => console.log(`Evidence Desk listening on 0.0.0.0:${config.port}`));
