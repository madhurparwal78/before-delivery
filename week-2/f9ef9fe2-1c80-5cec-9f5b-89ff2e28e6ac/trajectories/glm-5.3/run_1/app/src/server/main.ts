import express from "express";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { readConfig } from "./config";
import { pool } from "./db";
import { applySchemaAndSeed } from "./schema";
import { ApiError, notFound, sendError } from "./errors";
import { makeKillbill } from "./services/killbill";
import { makeStorage } from "./services/storage";
import { makeMail } from "./services/mail";
import { ServiceStatus } from "./services/status";
import { buildRouter } from "./api/router";
import { isBlockedPath } from "./api/boundary";
import { startBackgroundWork } from "./background";

const PUBLIC_DIR = path.join(__dirname, "public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

const APP_ROUTES = new Set(["/", "/signin", "/loom", "/bookings", "/papers", "/billing", "/members", "/rates", "/reports"]);

async function main(): Promise<void> {
  const config = readConfig();
  await applySchemaAndSeed(pool, config.holdSeconds);

  const killbill = makeKillbill(config);
  const storage = makeStorage(config);
  const mail = makeMail(config);
  const status = new ServiceStatus(killbill, storage, mail);

  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.use("/api", buildRouter({ config, status, killbill, storage, mail }));
  app.use("/api", () => {
    throw notFound();
  });

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next(notFound());
      return;
    }
    const pathname = req.path;
    if (isBlockedPath(pathname)) {
      next(notFound());
      return;
    }
    const relative = pathname.replace(/^\/+/, "");
    const file = path.join(PUBLIC_DIR, relative);
    if (relative.length > 0 && !file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
      next(notFound());
      return;
    }
    if (relative.length > 0 && existsSync(file) && statSync(file).isFile()) {
      res.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.end(readFileSync(file));
      return;
    }
    if (APP_ROUTES.has(pathname === "" ? "/" : pathname)) {
      const index = path.join(PUBLIC_DIR, "index.html");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(readFileSync(index));
      return;
    }
    next(notFound());
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    console.error("unhandled error:", error);
    res.status(500).json({ error: "internal", message: "Something went wrong." });
  });

  const server = app.listen(config.publicPort, "0.0.0.0", () => {
    console.log(`pilotlight serving on 0.0.0.0:${config.publicPort}`);
  });
  server.keepAliveTimeout = 65000;

  void status.boot();
  status.startLoop(10);
  startBackgroundWork(storage, mail);
}

void main();
