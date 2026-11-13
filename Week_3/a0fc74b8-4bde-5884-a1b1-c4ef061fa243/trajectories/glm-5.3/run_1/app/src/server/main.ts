import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { applySchema } from "./schema.js";
import { Storage } from "./storage.js";
import { Mailer } from "./mail.js";
import { LiveHubImpl } from "./live.js";
import { buildRoutes } from "./routes.js";
import { buildFlowRoutes } from "./flows.js";
import { buildSignRoutes } from "./sign.js";
import { buildTeamRoutes, buildTemplateRoutes } from "./team.js";
import { buildGradingRoutes } from "./grading.js";

export async function main(): Promise<void> {
  const cfg = loadConfig();
  const startAt = Date.now();

  const pool = new Pool({ connectionString: cfg.databaseUrl, max: 10 });

  // Retry database connection for up to 60 seconds.
  let connected = false;
  let lastErr: unknown = null;
  while (Date.now() - startAt < 60_000) {
    try {
      await pool.query("SELECT 1");
      connected = true;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!connected) {
    console.error("database unreachable", lastErr);
    process.exit(1);
  }
  await applySchema(pool);

  const storage = new Storage(cfg);
  const mailer = new Mailer(cfg);
  await Promise.all([storage.check(), mailer.check()]);

  const live = new LiveHubImpl();
  const instanceId = randomUUID();

  const ctx = {
    pool,
    cfg,
    actor: null,
    health: { mailOk: mailer.ok, storageOk: storage.ok, lastCheck: Date.now() },
    live,
    mailer,
    storage,
    instanceId,
  };

  const healthTimer = setInterval(async () => {
    const [s, m] = await Promise.all([storage.check(), mailer.check()]);
    ctx.health.storageOk = s;
    ctx.health.mailOk = m;
    ctx.health.lastCheck = Date.now();
    live.publishAll({ type: "health", mailOk: m, storageOk: s });
  }, 10_000);
  healthTimer.unref();

  const routes = [
    ...buildRoutes(),
    ...buildFlowRoutes(),
    ...buildSignRoutes(),
    ...buildTeamRoutes(),
    ...buildTemplateRoutes(),
    ...buildGradingRoutes(),
  ];

  const { createServer } = await import("node:http");
  const { handleRequest } = await import("./request.js");
  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, ctx, routes);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (typeof status === "number") {
        const body = (e as { body?: Record<string, unknown> }).body ?? { error: "internal" };
        if (!res.headersSent) {
          res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(body));
        } else {
          res.end();
        }
      } else {
        console.error("request error", e);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "internal" }));
        } else {
          res.end();
        }
      }
    }
  });

  const { WebSocketServer } = await import("ws");
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/live") {
      wss.handleUpgrade(req, socket, head, (ws) => live.register(ws, url.searchParams.get("team") ?? null, url.searchParams.get("doc") ?? null));
    } else {
      socket.destroy();
    }
  });

  server.listen(cfg.port, "0.0.0.0", () => {
    console.log(`undersign listening on ${cfg.port}`);
  });

  const { startBackground } = await import("./background.js");
  startBackground(ctx);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
