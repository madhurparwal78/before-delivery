import { createServer } from "node:http";
import { Accounts } from "./accounts.ts";
import { Assets } from "./assets.ts";
import { Collab } from "./collab.ts";
import { loadConfig } from "./config.ts";
import { Database } from "./db.ts";
import { databaseNotReady, writeError, writeJson } from "./errors.ts";
import { EventHub } from "./events.ts";
import { Exports } from "./exports.ts";
import { dispatch, Router } from "./http.ts";
import { Locks } from "./locks.ts";
import { OpLog } from "./ops.ts";
import { Sets } from "./sets.ts";
import { Shows } from "./shows.ts";
import { StatusMonitor } from "./status.ts";
import { serveStatic } from "./static.ts";
import { Storage } from "./storage.ts";
import { ActivityRoutes } from "./activity-routes.ts";
import { ShaderRoutes } from "./shaders.ts";

const config = loadConfig();
const monitor = new StatusMonitor();
const db = new Database(config.databaseUrl);
const collab = new Collab(config.valkeyUrl, (reachable) => monitor.noteCollab(reachable));
const hub = new EventHub(collab);
const storage = new Storage(config.storage, (reachable) => monitor.noteStorage(reachable));
monitor.onChange((status) => hub.broadcastStatus(status));

const accounts = new Accounts(db);
const router = new Router();
accounts.register(router);
new Sets(db).register(router);
new OpLog(db, collab, hub).register(router);
new Locks(db, collab, hub).register(router);
new Assets(db, storage).register(router);
new Shows(db, storage, hub).register(router);
new Exports(db, storage).register(router);
new ActivityRoutes(db).register(router);
new ShaderRoutes(db).register(router);
router.add("GET", "/api/health", { public: true }, async (ctx) => {
  if (!db.isReady()) throw databaseNotReady();
  writeJson(ctx.res, 200, { status: "ok" });
});
router.add("GET", "/api/status", { public: true }, async (ctx) => {
  writeJson(ctx.res, 200, monitor.current());
});

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/")) {
    void serveStatic(req, res, url.pathname);
    return;
  }
  const open = url.pathname === "/api/health" || url.pathname === "/api/status" || db.isReady();
  if (!open) {
    writeError(res, databaseNotReady());
    return;
  }
  void dispatch(router, { req, res, url }, (request) => accounts.resolve(request));
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection", reason instanceof Error ? reason.message : "unknown");
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`afterglass listening on ${config.port}`);
});
void db.connectUntilReady().then(() => monitor.start(storage, collab));
