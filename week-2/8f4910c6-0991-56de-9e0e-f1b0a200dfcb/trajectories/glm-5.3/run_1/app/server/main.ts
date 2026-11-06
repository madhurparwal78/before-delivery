import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { getPool, query } from "./db.js";
import { ApiError, sendError, errors } from "./http/errors.js";
import { tableMiddleware, type Route } from "./routes/table.js";
import { publicRoutes } from "./routes/public.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { seedIfEmpty, seedPhotoFor } from "./domain/seed.js";
import { runSweep, deliverMail, cleanupJobs } from "./domain/sweep.js";

let dbReady = false;

const app: Express = express();
app.disable("x-powered-by");
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.locals.starting = !dbReady;
  next();
});

const allRoutes: Route[] = [...publicRoutes, ...workspaceRoutes];
const dispatch = tableMiddleware(allRoutes);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/feeds/")) {
    dispatch(req, res, next);
    return;
  }
  next();
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    sendError(res, err);
    return;
  }
  if (!res.headersSent) {
    console.error("request failed:", err);
    res.status(500).json({ error: "server_error" });
  }
});

app.use(express.static(config.staticDir, { index: false, maxAge: "1h" }));

function sendIndex(res: Response): void {
  try {
    const html = readFileSync(path.join(config.staticDir, "index.html"), "utf8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch {
    res.status(500).send("Rungboard is starting.");
  }
}

const SOURCE_PATHS = /^\/(run\.json|package(-lock)?\.json|tsconfig(\.build)?\.json|THIRD_PARTY_NOTICES\.md|AGENTS\.md|scripts\/|server\/|shared\/|public-src\/|dist\/|node_modules\/).*/;

app.get(/^\/(?!api\/|feeds\/|app\.js|styles\.css|placeholder\.svg|fonts\/).*/, (req, res) => {
  if (req.method !== "GET" || SOURCE_PATHS.test(req.path)) {
    sendError(res, errors.notFound());
    return;
  }
  sendIndex(res);
});

app.use((_req: Request, res: Response) => {
  sendError(res, errors.notFound());
});

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await getPool().query("SELECT 1");
      dbReady = true;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function start(): Promise<void> {
  app.listen(config.port, "0.0.0.0");
  await waitForDatabase();
  await getPool().query(readFileSync(path.resolve("server/schema.sql"), "utf8"));
  await seedIfEmpty();
  const rows = await query<{ id: string }>(`SELECT id FROM talent WHERE state = 'active' ORDER BY created_at`);
  for (const [index, row] of rows.entries()) {
    await seedPhotoFor(row.id, index).catch((err) => {
      console.error("photo seed failed", err);
    });
  }
  void (async (): Promise<void> => {
    for (;;) {
      await runSweep().catch(() => {});
      await deliverMail().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  })();
  void (async (): Promise<void> => {
    for (;;) {
      await cleanupJobs().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  })();
}

start().catch((err) => {
  console.error("start failed", err);
  process.exit(1);
});
