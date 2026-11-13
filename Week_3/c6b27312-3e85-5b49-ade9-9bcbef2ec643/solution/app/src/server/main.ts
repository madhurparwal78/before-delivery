// Tinework server: one process, bound before its dependencies are ready so that health can say what is missing.
import { createServer } from "node:http";
import { archiveRoutes } from "./archive";
import { authRoutes } from "./auth";
import { compareRoutes } from "./compare";
import { config } from "./config";
import { dashboardRoutes } from "./dashboard";
import { connectDatabase } from "./db";
import { evaluationRoutes } from "./evaluation";
import { eventRoutes, startRelay } from "./events";
import { gradingRoutes } from "./grading";
import { healthRoutes, readiness } from "./health";
import { createHandler } from "./http";
import { objectRoutes } from "./objects";
import { loadCursorSecret, partRoutes } from "./parts";
import { preflightRoutes } from "./preflight";
import { revisionRoutes } from "./revisions";
import { roomRoutes } from "./rooms";
import { seed } from "./seed";
import { ensureBucket, storageReachable } from "./storage";

const SEED_RETRY_MS = 5000;

const routes = [
  ...healthRoutes,
  ...authRoutes,
  ...partRoutes,
  ...revisionRoutes,
  ...evaluationRoutes,
  ...preflightRoutes,
  ...compareRoutes,
  ...objectRoutes,
  ...archiveRoutes,
  ...roomRoutes,
  ...dashboardRoutes,
  ...eventRoutes,
  ...gradingRoutes,
];

process.on("unhandledRejection", (reason) => console.error("unhandled rejection:", reason));

const server = createServer(createHandler(routes));
// Longer than the idle time of any proxy or browser in front, so a reused connection is never one we just closed.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(config.port, "0.0.0.0", () => console.log(`tinework listening on ${config.port}`));

/** Seeds when storage is reachable; otherwise leaves it to a copy that can reach storage and tries again later. */
async function seedWhenPossible(): Promise<void> {
  let seeded = false;
  if (await storageReachable()) {
    try {
      await seed();
      seeded = true;
    } catch (error) {
      console.error("seeding failed:", (error as Error).message);
    }
  }
  readiness.seeded = true;
  if (!seeded) setTimeout(() => void seedWhenPossible(), SEED_RETRY_MS).unref();
}

await connectDatabase();
await loadCursorSecret();
startRelay();
await ensureBucket();
await seedWhenPossible();
