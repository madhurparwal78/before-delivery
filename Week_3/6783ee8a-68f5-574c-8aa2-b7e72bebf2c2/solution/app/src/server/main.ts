import { createServer } from "node:http";
import { settings } from "./config";
import { prepareDatabase } from "./db";
import { dispatch } from "./http";
import type { Route } from "./http";
import { runIndexer } from "./search";
import { markReady, ready } from "./state";
import { storageReachable } from "./storage";
import { seedDemo } from "./seed-demo";
import { serveStatic } from "./static";
import { authRoutes } from "./routes/auth";
import { acceptInvitationRoute, readInvitation } from "./routes/invitations";
import { cellRoutes } from "./routes/cells";
import { checkpointRoutes } from "./routes/checkpoints";
import { fileRoutes } from "./routes/files";
import { seed } from "./routes/grading";
import { notebookRoutes } from "./routes/notebooks";
import { presenceRoutes, startSweeper } from "./routes/presence";
import { runRoutes } from "./routes/runs";
import { shareRoutes } from "./routes/shares";
import { systemRoutes } from "./routes/system";

const routes: Route[] = [
  ...systemRoutes,
  ...authRoutes,
  ...notebookRoutes,
  ...cellRoutes,
  ...runRoutes,
  ...presenceRoutes,
  ...checkpointRoutes,
  ...fileRoutes,
  ...shareRoutes,
  readInvitation,
  acceptInvitationRoute,
  seed,
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  const starting = url.pathname.startsWith("/api/") && url.pathname !== "/api/health" && !ready();
  if (starting) {
    res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "starting" }));
    return;
  }
  const work = url.pathname.startsWith("/api/") ? dispatch(routes, req, res, url) : serveStatic(url.pathname, res);
  work.catch((error) => {
    console.error(error);
    if (res.headersSent) return res.end();
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "internal_error", message: "Something went wrong." }));
  });
});

server.listen(settings.port, "0.0.0.0", () => console.log(`brackenpad listening on ${settings.port}`));

async function boot(): Promise<void> {
  await prepareDatabase();
  await seedDemo();
  markReady();
  startSweeper();
  setInterval(() => void runIndexer(), 2000);
  setInterval(() => void storageReachable(), 2500);
  void storageReachable();
  void runIndexer();
}

boot().catch((error) => {
  console.error("boot failed:", error);
  process.exit(1);
});
