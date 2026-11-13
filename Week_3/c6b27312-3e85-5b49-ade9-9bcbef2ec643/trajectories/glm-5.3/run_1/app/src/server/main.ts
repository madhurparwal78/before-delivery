import { createServer } from "node:http";
import express from "express";
import { AppCtx } from "./ctx.js";
import { applySchema, connect } from "./db.js";
import { loadConfig } from "./config.js";
import { S3Client } from "./s3.js";
import { Redis } from "ioredis";
import { apiRouter } from "./router.js";
import { Api } from "./api.js";
import { seed } from "./seeding.js";
import { relayOutbox } from "./events.js";
import { staticAsset, isBlocked } from "./static.js";
import { pageOr404 } from "./shell.js";
import { httpError, sendError, ERR as E } from "./http.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");

  // Database: retry every 2 seconds until it connects.
  let db: Awaited<ReturnType<typeof connect>> | null = null;
  for (;;) {
    try {
      db = await connect(config.databaseUrl);
      await applySchema(db);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  // Health answers 503 while the database is down (handled inside the router).
  const s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    bucket: config.s3.bucket,
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  });
  const redis = new Redis(config.valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: null });
  redis.on("error", () => { /* pages work without live updates */ });
  try { await redis.connect(); } catch { /* recover when Valkey returns */ }

  const ctx = new AppCtx(db, s3, redis, config);
  ctx.markDb(true);
  try { await s3.createBucket(); ctx.markStorage(true); } catch { ctx.markStorage(false); }

  const api = new Api(ctx);
  await seed(ctx);
  relayOutbox(ctx);

  // Server boundary: cross-origin writes refused; bodies limited; one error shape.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      try {
        if (new URL(origin).host !== req.headers.host) return sendError(res, E.crossOrigin());
      } catch { /* malformed origin: not cross-origin */ }
    }
    next();
  });

  app.use("/api", apiRouter(ctx));
  app.get("/auth/verify", (req, res, next) => { void api.verify(req, res).catch(next); });

  // Pages and static assets, all same-origin.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      sendError(res, E.notFound());
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    // Never serve application source, maps, env files or listings.
    if (isBlocked(req.path)) {
      sendError(res, E.notFound());
      return;
    }
    const asset = staticAsset(req.path);
    if (asset) {
      res.set("Cache-Control", "public, max-age=3600");
      res.type(asset.type).send(asset.body);
      return;
    }
    const page = pageOr404(req.path);
    res.status(page.status).type("html").send(page.html);
  });

  // Unknown /api path: the 404 body.
  app.use("/api", (_req, res) => sendError(res, E.notFound()));

  // One error shape for anything thrown.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err && typeof err === "object" && "status" in err && "body" in err) {
      sendError(res, err as { status: number; body: Record<string, unknown> });
      return;
    }
    console.error(err);
    sendError(res, httpError(500, "internal", "Something went wrong."));
  });

  server.listen(config.publicPort, "0.0.0.0");
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
