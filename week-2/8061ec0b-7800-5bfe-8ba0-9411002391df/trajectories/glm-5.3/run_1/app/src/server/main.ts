// Bootstrap: load config, ensure schema and seed exactly once under one
// Postgres advisory lock, ensure the Kill Bill tenant and catalog, then
// serve on the published port.
import { loadConfig } from "./config.js";
import { Clock } from "./clock.js";
import { createDb } from "./db.js";
import { ensureSchema } from "./schema.js";
import { ensureSeed } from "./seed.js";
import { HttpServer } from "./http/server.js";
import { registerAllRoutes } from "./api/routes.js";
import { KillBillClient } from "./services/killbill.js";
import { StorageService } from "./services/storage.js";
import { Mailer } from "./services/mailer.js";
import { sweepExpiredContracts } from "./domain/contractState.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const clock = new Clock(config.clockStart);
  const db = createDb(config.databaseUrl);
  const killbill = new KillBillClient(
    config.killbillUrl,
    config.killbillUsername,
    config.killbillPassword,
    config.killbillApiKey,
    config.killbillApiSecret
  );
  const storage = new StorageService({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    bucket: config.s3Bucket,
    forcePathStyle: config.s3ForcePathStyle,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  });
  const mailer = new Mailer({ host: config.smtpHost, port: config.smtpPort, from: config.mailFrom });

  const server = new HttpServer(config.port);
  let ready = false;
  server.healthReady = () => ready;

  registerAllRoutes(server, { db, clock, config, storage, killbill, mailer });

  // Serve as soon as the port is free, but answer health 503 until the
  // schema and seed are in place.
  await server.listen();
  process.stdout.write(`bellroll listening on 0.0.0.0:${config.port}\n`);

  // Schema and seed, retrying while Postgres is unreachable.
  let connected = false;
  while (!connected) {
    try {
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('bellroll-startup'))");
        await ensureSchema(
          (sql, params) => client.query(sql, params),
          (sql, params) => client.query(sql, params),
          (sql, params) => client.query(sql, params)
        );
        await ensureSeed(client, clock.now());
        await client.query("COMMIT");
        connected = true;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      process.stderr.write(`waiting for postgres: ${(err as Error).message}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // The catalog upload shares one advisory lock across instances.
  try {
    await db.withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('bellroll-killbill-setup'))");
      try {
        await killbill.ensureTenant(config.killbillUsername, config.killbillPassword);
        await killbill.ensureCatalog();
      } catch {
        // Kill Bill is unreachable at boot; only the actions that need it
        // answer 503.
      }
    });
  } catch {
    // Postgres hiccup: the lazy ensure on first use will retry.
  }

  // A hold expires on its own, with no request needed to trigger it.
  const sweepTimer = setInterval(() => {
    void db
      .withTransaction(async (client) => {
        await sweepExpiredContracts(client, clock.now());
      })
      .catch(() => undefined);
  }, 500);
  sweepTimer.unref();

  ready = true;
  process.stdout.write("bellroll ready\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
