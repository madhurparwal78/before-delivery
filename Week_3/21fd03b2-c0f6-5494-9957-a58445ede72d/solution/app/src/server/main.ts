import http from "node:http";
import { config } from "./config";
import { migrate } from "./db";
import { registerAssetRoutes } from "./assets";
import { registerAuthRoutes } from "./auth";
import { registerCollabRoutes } from "./collab";
import { handleRequest, route } from "./http";
import { registerLabRoutes } from "./labs";
import { startMailSweeper } from "./mail";
import { registerSceneRoutes } from "./scenes";
import { seed } from "./seed";
import { s3 } from "./services/s3";
import { getStatus, startStatusMonitor } from "./services/status";
import { registerWorkspaceRoutes } from "./workspaces";

registerAuthRoutes();
registerWorkspaceRoutes();
registerSceneRoutes();
registerCollabRoutes();
registerAssetRoutes();
registerLabRoutes();
route("GET", "/api/health", async () => ({ status: 200, json: { status: "ok" } }), { public: true });
route("GET", "/api/status", async () => ({ status: 200, json: getStatus() }), { public: true });

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(work: () => Promise<void>, delayMs: number): Promise<void> {
  for (;;) {
    try {
      await work();
      return;
    } catch {
      await wait(delayMs);
    }
  }
}

const ready = (async () => {
  await retry(async () => {
    await migrate();
    await seed();
  }, 1000);
})();

void retry(() => s3.ensureBucket(), 2000);
startStatusMonitor();
startMailSweeper();

const server = http.createServer((req, res) => {
  const gate = req.url?.startsWith("/api/health") ? Promise.resolve() : ready;
  void gate.then(() => handleRequest(req, res));
});
server.keepAliveTimeout = 65000;
server.listen(config.port, "0.0.0.0");
