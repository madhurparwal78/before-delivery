import { configWithSecret, resolveSecret } from "./config.js";
import { migrateAndSeed, query, pool } from "./db.js";
import { App, createHttpServer } from "./http.js";
import { startScheduler } from "./scheduler.js";
import { authRoutes } from "./routes/auth.js";
import { programmeRoutes } from "./routes/programme.js";
import { holdsRoutes } from "./routes/holds.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { artRoutes } from "./routes/art.js";
import { boxOfficeRoutes } from "./routes/boxoffice.js";
import { financeRoutes } from "./routes/finance.js";
import { groupRoutes } from "./routes/group.js";
import { adminRoutes } from "./routes/admin.js";

async function main(): Promise<void> {
  // Schema and seed data are applied idempotently every time the server starts.
  await migrateAndSeed();
  const secret = await resolveSecret(query);
  const config = configWithSecret(secret);
  const app = new App(config);
  app.routes = [
    ...authRoutes(),
    ...programmeRoutes(),
    ...holdsRoutes(),
    ...checkoutRoutes(),
    ...artRoutes(),
    ...boxOfficeRoutes(),
    ...financeRoutes(),
    ...groupRoutes(),
    ...adminRoutes(),
  ];

  const server = await createHttpServer(app);
  server.listen(config.port, "0.0.0.0", () => {
    process.stdout.write(`kerf listening on ${config.port}\n`);
  });

  startScheduler(app);

  const shutdown = (): void => {
    server.close(() => {
      pool.end().then(() => process.exit(0));
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  process.stderr.write(`boot failed: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
