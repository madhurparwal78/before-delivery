import express from "express";
import type { Request, Response } from "express";
import { JSON_BODY_LIMIT, MULTIPART_LIMIT, PORT } from "./config.js";
import { asyncRoute, loadUser, sendError } from "./auth.js";
import { ApiError } from "./errors.js";
import { router as routes } from "./routes.js";
import { migrateAndSeed } from "./seed.js";
import { startJobs } from "./jobs.js";
import { billingOk, checkBilling } from "./killbill.js";
import { checkMail, queuedCount, mailHealthy } from "./mailer.js";
import path from "node:path";
import { readFile } from "node:fs/promises";

const app = express();
app.disable("x-powered-by");
app.set("etag", false);

// Every response: nosniff.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// Same-origin writes only, before any other check.
app.use((req: Request, res: Response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      let host = req.headers.host ?? "";
      let originHost = "";
      try { originHost = new URL(origin).host; } catch { originHost = ""; }
      if (originHost !== host) {
        sendError(res, new ApiError(403, "cross_origin", "Cross-origin writes are not allowed."));
        return;
      }
    }
  }
  next();
});

// JSON body limits; non-JSON on JSON endpoints; multipart handled per-route.
app.use((req: Request, res: Response, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") { next(); return; }
  const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim();
  const isMultipart = contentType === "multipart/form-data";
  const length = Number(req.headers["content-length"] ?? "0");
  const limit = isMultipart ? MULTIPART_LIMIT : JSON_BODY_LIMIT;
  if (length > limit) {
    sendError(res, new ApiError(413, "body_too_large", "The request body is too large."));
    return;
  }
  if (!req.headers["content-type"]) { next(); return; }
  if (isMultipart) {
    (req as unknown as { isMultipart: boolean }).isMultipart = true;
    next();
    return;
  }
  if (contentType !== "application/json") {
    sendError(res, new ApiError(415, "unsupported_media_type", "Send application/json."));
    return;
  }
  express.json({ limit: JSON_BODY_LIMIT, type: () => true })(req, res, (err?: unknown) => {
    if (err) {
      sendError(res, new ApiError(400, "invalid_json", "The request body is not valid JSON."));
      return;
    }
    next();
  });
});

// Parse cookies.
app.use((req: Request, _res: Response, next) => {
  const header = req.headers.cookie ?? "";
  const jar: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  (req as unknown as { cookies: Record<string, string> }).cookies = jar;
  next();
});

app.use(asyncRoute(async (req, _res, next) => {
  req.user = (await loadUser(req)) ?? undefined;
  next();
}));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/status", asyncRoute(async (_req, res) => {
  const queued = await queuedCount();
  res.json({
    billing: billingOk() ? "ok" : "delayed",
    mail: mailHealthy() ? "ok" : "delayed",
    queued_emails: queued,
  });
}));

app.use(routes);

// Static client files, never source or config.
const PUBLIC_FILES = new Set(["index.html", "app.js", "app.css", "binder.css"]);
app.use((req: Request, res: Response, _next) => {
  const clean = path.normalize(req.path).replace(/^(\.\.[/\\])+/, "");
  const file = clean === "/" ? "index.html" : clean.replace(/^\//, "");
  const allowed =
    PUBLIC_FILES.has(file) ||
    file.startsWith("fonts/") && file.endsWith(".woff2") ||
    file.startsWith("icons/") && file.endsWith(".svg");
  if (!allowed) {
    res.status(404).send("Not found");
    return;
  }
  const safe = path.join("dist/client", path.normalize(file));
  if (!safe.startsWith("dist/client")) { res.status(404).send("Not found"); return; }
  readFile(safe)
    .then((buf) => {
      if (file.endsWith(".html")) res.setHeader("Content-Type", "text/html; charset=utf-8");
      else if (file.endsWith(".js")) res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      else if (file.endsWith(".css")) res.setHeader("Content-Type", "text/css; charset=utf-8");
      else if (file.endsWith(".svg")) res.setHeader("Content-Type", "image/svg+xml");
      else if (file.endsWith(".woff2")) res.setHeader("Content-Type", "font/woff2");
      else res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
    })
    .catch(() => res.status(404).send("Not found"));
});

// One error shape everywhere.
app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  if (err instanceof ApiError) {
    sendError(res, err);
    return;
  }
  console.error("unhandled error", err);
  sendError(res, new ApiError(500, "internal", "Something went wrong."));
});

export async function boot(): Promise<void> {
  await migrateAndSeed();
  await Promise.all([checkBilling(), checkMail()]);
  startJobs();
  const server = app.listen(PORT, "0.0.0.0");
  server.on("error", (e: unknown) => {
    console.error("listen failed", e);
    process.exit(1);
  });
  console.log(`hearthshift serving on 0.0.0.0:${PORT}`);
}

if (process.argv[1] && process.argv[1].endsWith("main.js")) {
  void boot();
}
