// Entry point: boot the server, retrying Postgres for up to 60 seconds,
// then apply schema and seed idempotently and serve app plus API.
import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { Db } from "./db.js";
import { migrate, seed } from "./seed.js";
import { Storage } from "./services/storage.js";
import { Renderer } from "./services/renderer.js";
import { Mailer } from "./services/mailer.js";
import { EmailService } from "./services/emails.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerRegistrationRoutes } from "./routes/registrations.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerResultsRoutes } from "./routes/results.js";
import { registerSeasonRoutes } from "./routes/season.js";
import { serveStatic } from "./static.js";

const BOOT_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = await waitForDatabase(config.databaseUrl);
  const db = new Db(config.databaseUrl);

  const storage = new Storage(config.s3);
  const renderer = new Renderer(config.gotenbergUrl);
  const mailer = new Mailer(config.smtp, config.mailFrom);
  const emails = new EmailService(db, mailer);
  emails.startRetryLoop();

  await migrate(pool);
  await seed(pool, config, storage);

  const app = buildApp(db, config);
  registerAuthRoutes(app, db);
  registerEventRoutes(app, db, config);
  registerRegistrationRoutes(app, db, { storage, renderer, emails, config });
  registerRunRoutes(app, db);
  registerResultsRoutes(app, db, { storage, renderer, mailer, config });
  registerSeasonRoutes(app, db);

  serveStatic(app);

  const address = await app.listen({ port: config.appPublicPort, host: "0.0.0.0" });
  console.log(`Conecount Paddock serving on ${address}`);
}

async function waitForDatabase(url: string): Promise<Pool> {
  const started = Date.now();
  for (;;) {
    const pool = new Pool({ connectionString: url, max: 2 });
    try {
      await pool.query("SELECT 1");
      return pool;
    } catch (e) {
      await pool.end().catch(() => undefined);
      if (Date.now() - started > BOOT_TIMEOUT_MS) {
        console.error("Postgres unreachable at boot:", e);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
