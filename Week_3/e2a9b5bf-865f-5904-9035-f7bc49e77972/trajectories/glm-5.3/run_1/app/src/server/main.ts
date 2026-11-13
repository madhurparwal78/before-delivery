// Server entry: bind, prepare the database and serve (DP-53).
import { readConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createPool, prepare } from "./db.js";
import { makeStorage } from "./services/storage.js";
import { makeRenderer } from "./services/renderer.js";
import { makeMail } from "./services/mail.js";

async function main(): Promise<void> {
  const config = readConfig();
  const pool = createPool(config.databaseUrl);
  const storage = makeStorage(config);
  const renderer = makeRenderer(config.gotenbergUrl);
  const mail = makeMail(config.smtp.host, config.smtp.port);

  const app = buildApp({ config, pool, storage, renderer, mail });
  const server = app.listen(config.port, "0.0.0.0");
  console.log(`lowlamp serving on 0.0.0.0:${config.port}`);

  // Prepare (schema and seed) in the background; health answers starting
  // until Postgres is reachable (DP-48, DP-53).
  const prepareOnce = async (): Promise<void> => {
    for (;;) {
      try {
        await pool.query("SELECT 1");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    await prepare(pool, config, storage);
    console.log("lowlamp schema and seed applied");
  };
  void prepareOnce();
  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
