import { config } from "./config.js";
import { closeBroker } from "./broker.js";
import { migrate } from "./db.js";
import { startFulfilment } from "./events.js";
import { buildApp } from "./http.js";
import { provision } from "./identity.js";
import { startJobs } from "./jobs.js";
import { registerAuthRoutes } from "./routes-auth.js";
import { registerPublicRoutes } from "./routes-public.js";
import { registerStaffRoutes } from "./routes-staff.js";
import { ensureBucket } from "./s3.js";
import { prepareIndexes } from "./search.js";
import { syncBoxes } from "./searching.js";
import { startShelf } from "./shelf.js";
import { registerStatic } from "./static.js";
import { startSweeper } from "./sweeper.js";
import { ensureApplication, syncEndpoint } from "./svix.js";
import { connectValkey, isUp } from "./valkey.js";
import "./handlers.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries a start-up step until its service answers, then never again: the app serves meanwhile. */
const untilDone = (name: string, work: () => Promise<void>): void => {
  void (async () => {
    for (;;) {
      try {
        await work();
        return;
      } catch (error) {
        process.stderr.write(`${name}: waiting for the service (${error instanceof Error ? error.constructor.name : "error"})\n`);
        await sleep(2000);
      }
    }
  })();
};

const migrated = async (): Promise<boolean> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await migrate();
      return true;
    } catch {
      await sleep(1000);
    }
  }
  return false;
};

const main = async (): Promise<void> => {
  const app = await buildApp();
  registerAuthRoutes(app);
  registerPublicRoutes(app);
  registerStaffRoutes(app);
  registerStatic(app);

  connectValkey();
  const ready = await migrated();
  for (let waited = 0; waited < 3000 && !isUp(); waited += 100) await sleep(100);
  await app.listen({ host: "0.0.0.0", port: config.port });

  if (!ready) untilDone("database", migrate);
  startShelf();
  startJobs();
  startFulfilment();
  startSweeper();
  untilDone("identity", provision);
  untilDone("storage", ensureBucket);
  untilDone("search", async () => {
    await prepareIndexes();
    await syncBoxes(null);
  });
  untilDone("webhooks", async () => {
    await ensureApplication();
    await syncEndpoint();
  });

  const stop = (): void => {
    void closeBroker().finally(() => void app.close().finally(() => process.exit(0)));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
};

void main();
