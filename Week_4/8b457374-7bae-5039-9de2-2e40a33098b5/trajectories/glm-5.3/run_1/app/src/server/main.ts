import express from "express";
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import pg from "pg";
import { createContext } from "./context.js";
import { applySchema } from "./schema.js";
import { seedIfEmpty } from "./seed.js";
import { createApiRouter, createErrorForwarder } from "./routes.js";
import { NoticeService } from "./notices.js";
import { CampaignWorkers } from "./workers.js";
import { ApiError, sendError } from "./errors.js";

// The server binds 0.0.0.0, retries Postgres until it connects, starts
// whatever the state of the other services, and never serves source,
// configuration, installed dependencies or credentials.

const PUBLIC_DIR = join(process.cwd(), "public");

async function waitForDatabase(pool: pg.Pool): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main(): Promise<void> {
  const ctx = await createContext();
  await waitForDatabase(ctx.pool);
  await applySchema(ctx.pool);
  await seedIfEmpty(ctx.pool, ctx.config, ctx.storage);

  const notices = new NoticeService(ctx.pool, ctx.config, ctx.mail);
  const workers = new CampaignWorkers(ctx, notices);
  workers.start();
  ctx.health.startProbing();

  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    // Same-origin only: no cross-origin permission headers are ever sent.
    res.removeHeader("Access-Control-Allow-Origin");
    res.removeHeader("Access-Control-Allow-Headers");
    res.removeHeader("Access-Control-Allow-Methods");
    res.removeHeader("Access-Control-Allow-Credentials");
    next();
  });

  const api = createApiRouter(ctx, notices);
  app.use("/", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      api(req, res, next);
      return;
    }
    next();
  });

  // Any unknown /api path answers the not-found JSON shape.
  app.use("/api", (req, res) => {
    sendError(res, new ApiError(404, "not_found"));
  });

  // Static assets and page routes. Any page path resolves to its screen; an
  // unknown path shows the not-found page.
  const PAGES: Record<string, string> = {
    "": "index.html",
    "campaigns": "campaigns/index.html",
    "pledges": "pledges/index.html",
    "studio": "studio/index.html",
    "studio/new": "studio/editor.html",
  };

  const pageFor = (path: string): string | null => {
    const clean = path.replace(/^\/+|\/+$/g, "");
    if (PAGES[clean] !== undefined) return PAGES[clean];
    if (/^campaigns\/[^/]+$/.test(clean)) return "campaigns/campaign.html";
    if (/^studio\/campaigns\/[^/]+$/.test(clean)) return "studio/editor.html";
    if (/^fix\/[^/]+$/.test(clean)) return "fix/index.html";
    return null;
  };

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const requested = req.path.replace(/^\/+/, "");

    // The page route wins for exact page paths and campaign/studio/fix slugs.
    const page = pageFor(requested);
    if (page !== null) {
      res.sendFile(join(PUBLIC_DIR, page), (error) => {
        if (error !== undefined) next(error);
      });
      return;
    }

    // Static assets come from the public directory only.
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    if (
      safePath.length === 0 ||
      safePath.startsWith("/") ||
      safePath.includes("..") ||
      safePath.startsWith("node_modules") ||
      safePath.startsWith("src") ||
      safePath.startsWith("dist") ||
      ["run.json", "package.json", "package-lock.json", "tsconfig.json", ".env"].includes(safePath)
    ) {
      next();
      return;
    }
    const filePath = join(PUBLIC_DIR, safePath);
    if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
      next();
      return;
    }
    res.sendFile(filePath, (error) => {
      if (error !== undefined) next(error);
    });
  });

  // Any unknown page path shows the not-found page.
  app.use((req, res) => {
    res.status(404).sendFile(join(PUBLIC_DIR, "404.html"));
  });

  app.use(createErrorForwarder());

  const port = ctx.config.appPublicPort;
  app.listen(port, "0.0.0.0", () => {
    console.log(`dotgain listening on 0.0.0.0:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
