import { startTicker } from "./classroom-events";
import { startDatabase } from "./db";
import { startServer } from "./http";
import { accountRoutes } from "./routes/account";
import { classroomRoutes } from "./routes/classrooms";
import { exportRoutes } from "./routes/exports";
import { joinRoutes } from "./routes/join";
import { projectRoutes } from "./routes/projects";
import { systemRoutes } from "./routes/system";
import { ensureBucket } from "./s3";
import { serveStatic } from "./static";
import { sweepOrphanedObjects } from "./storage-cleanup";
import { streamRoute } from "./stream";
import { endAllStreams } from "./stream-hub";
import { config } from "./config";
import { logged } from "./failures";

const routes = [...accountRoutes, ...joinRoutes, ...classroomRoutes, ...projectRoutes, ...exportRoutes, streamRoute, ...systemRoutes];
const server = startServer(routes, serveStatic);

ensureBucket().catch(logged("bucket check at start (retried on first use)", undefined));
startDatabase(async () => {
  await sweepOrphanedObjects().catch(logged("orphaned object sweep", undefined));
  startTicker();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    endAllStreams();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

console.log(`Quarkyard listening on ${config.port}`);
