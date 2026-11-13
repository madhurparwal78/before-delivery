import { createServer } from "node:http";
import { config } from "./config.ts";
import { pool, waitForPostgres } from "./db.ts";
import { handler, json, publicRoute } from "./http.ts";
import { startLive } from "./live.ts";
import { startLockClock } from "./lock.ts";
import { deliverNotices, startNoticeDelivery } from "./notices.ts";
import { ensurePocketBase, PocketBaseUnreachable } from "./pocketbase.ts";
import { accountRoutes } from "./routes/accounts.ts";
import { catalogueRoutes } from "./routes/catalogue.ts";
import { historyRoutes } from "./routes/history.ts";
import { leagueRoutes } from "./routes/leagues.ts";
import { noticeRoutes } from "./routes/notices.ts";
import { operatorRoutes } from "./routes/operator.ts";
import { squadRoutes } from "./routes/squad.ts";
import { transferRoutes } from "./routes/transfers.ts";
import { migrate } from "./schema.ts";
import { startSnapshotWriter, writeSnapshots } from "./snapshots.ts";
import { ensureBucket, StorageUnreachable } from "./storage.ts";

const routes = [
  publicRoute("GET", "/api/health", async () => json(200, { status: "ok" })),
  ...accountRoutes,
  ...catalogueRoutes,
  ...squadRoutes,
  ...transferRoutes,
  ...historyRoutes,
  ...leagueRoutes,
  ...noticeRoutes,
  ...operatorRoutes,
];

// MinIO and PocketBase may be down at boot: the server starts anyway and sets them up once reachable.
function untilReady(name: string, setup: () => Promise<void>, unreachable: (error: unknown) => boolean): void {
  const attempt = () =>
    setup().catch((error: unknown) => {
      if (!unreachable(error)) console.error(`${name} setup:`, (error as Error).message);
      setTimeout(attempt, 3000).unref();
    });
  void attempt();
}

async function main(): Promise<void> {
  try {
    await waitForPostgres(60);
  } catch (error) {
    console.error("postgres stayed unreachable for 60 seconds:", (error as Error).message);
    process.exit(1);
  }
  const installId = await migrate();
  const server = createServer(handler(routes));
  startLive(server, (message) => void (message.t === "outbox" ? deliverNotices() : writeSnapshots()));
  server.listen(config.port, "0.0.0.0", () => console.log(`Elevens is serving on port ${config.port}`));
  untilReady("PocketBase", ensurePocketBase, (error) => error instanceof PocketBaseUnreachable);
  untilReady("MinIO", ensureBucket, (error) => error instanceof StorageUnreachable);
  startLockClock();
  startNoticeDelivery(installId);
  startSnapshotWriter();
  const stop = () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

void main();
