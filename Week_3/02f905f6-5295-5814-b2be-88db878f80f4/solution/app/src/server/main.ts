// Shelfmark server: binds first, answers health while it waits for Postgres, then migrates and serves.
import { createServer } from "node:http";
import { config } from "./config";
import { migrate, pool, tx } from "./db";
import { apiHandler, securityHeaders, sendJson } from "./http";
import { startBackgroundWork } from "./outbox";
import { firingRoutes } from "./routes/firings";
import { intakeRoutes } from "./routes/intake";
import { photoRoutes } from "./routes/photos";
import { pieceRoutes } from "./routes/pieces";
import { rateRoutes } from "./routes/rates";
import { sessionRoutes } from "./routes/session";
import { ensureMemberAccounts, studioRoutes } from "./routes/studio";
import { serveStatic } from "./static";
import { ensureBucket } from "./storage";

let ready = false;

const api = apiHandler([...sessionRoutes, ...rateRoutes, ...photoRoutes, ...intakeRoutes, ...pieceRoutes, ...firingRoutes, ...studioRoutes]);

const server = createServer((req, res) => {
  securityHeaders(res);
  const url = new URL(req.url ?? "/", "http://shelfmark.invalid");
  if (url.pathname === "/api/health") {
    sendJson(res, ready ? 200 : 503, { status: ready ? "ok" : "starting" });
    req.resume();
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    if (!ready) {
      sendJson(res, 503, { error: "starting", message: "The studio server is starting." });
      req.resume();
      return;
    }
    void api(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(config.port, "0.0.0.0", () => console.log(`Shelfmark listening on 0.0.0.0:${config.port}`));

const MEMBER_ACCOUNTS_LOCK = 2_026_402;

async function boot(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      await migrate();
      break;
    } catch (error) {
      console.error(`Postgres not ready (${(error as Error).message}); retrying in 2 s`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  ready = true;
  console.log("Shelfmark ready");
  startBackgroundWork();
  ensureBucket().catch((error: Error) => console.error("storage not ready:", error.message));
  tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [MEMBER_ACCOUNTS_LOCK]);
    await ensureMemberAccounts();
  }).catch((error: Error) => console.error("member billing accounts not created yet:", error.message));
}

void boot();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
