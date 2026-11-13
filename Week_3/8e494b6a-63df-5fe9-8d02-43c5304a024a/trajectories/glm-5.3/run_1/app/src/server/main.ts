/**
 * The Spoorline server: schema, start seed, API routes, static pages and SSE.
 */
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { initClock } from "./clock";
import { ApiError, apiErrorHandler, errors } from "./errors";
import { applySchema, pool, withDb } from "./db";
import { heartbeatAll } from "./bus";
import { heartbeatTails } from "./tail";
import { platformRoutes } from "./platform";
import { streamRoutes } from "./streams-api";
import { searchRoutes } from "./search-api";
import { uploadRoutes } from "./uploads-api";
import { featureRoutes } from "./feature-api";
import { gradingRoutes } from "./grading";
import { seedStartData } from "./start-seed";
import { patchRouterPromises } from "./router-patch";
import { appJs, fontFile } from "./assets";

const JSON_LIMIT = 1000000;

async function waitForPostgres(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  process.exit(1);
}

async function main(): Promise<void> {
  initClock();
  await waitForPostgres();
  await applySchema();
  await seedStartData();

  const app = express();
  app.disable("x-powered-by");
  patchRouterPromises(app as unknown as Parameters<typeof patchRouterPromises>[0]);

  // Raw body capture for ndjson and multipart, JSON for the rest.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const type = String(req.headers["content-type"] ?? "");
    const isNdjson = type.includes("application/x-ndjson");
    const isMultipart = type.includes("multipart/form-data");
    const isJson = type.includes("application/json");
    const limit = isNdjson || isMultipart
      ? config().settings.upload_max_bytes
      : JSON_LIMIT;
    let data: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        if (isNdjson || isMultipart) {
          res.status(413).json({
            error: "upload_too_large",
            message: `Upload is larger than ${config().settings.upload_max_bytes} bytes.`,
          });
        } else {
          res.status(413).json({
            error: "body_too_large",
            message: "Request body is larger than 1000000 bytes.",
          });
        }
        req.destroy();
        return;
      }
      data.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      const raw = Buffer.concat(data);
      if (isJson) {
        try {
          (req as unknown as { body: unknown }).body = raw.length === 0 ? {} : JSON.parse(raw.toString("utf8"));
        } catch {
          res.status(400).json({ error: "invalid", message: "Check the highlighted fields." });
          return;
        }
        (req as unknown as { rawBody: Buffer }).rawBody = raw;
        next();
        return;
      }
      if (isNdjson) {
        (req as unknown as { body: unknown }).body = raw.toString("utf8");
        next();
        return;
      }
      if (isMultipart) {
        parseMultipart(req, raw);
        next();
        return;
      }
      (req as unknown as { body: unknown }).body = raw.toString("utf8");
      next();
    });
  });

  platformRoutes(app);
  streamRoutes(app);
  searchRoutes(app);
  uploadRoutes(app);
  featureRoutes(app);
  if (config().grading) {
    gradingRoutes(app);
  }

  app.use(apiErrorHandler);

  // Static assets: fonts, built JS and CSS. No source files are served.
  app.get("/assets/app.js", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(appJs());
  });
  app.get("/assets/fonts/:name", (req: Request, res: Response) => {
    const allowed = ["inter-latin.woff2", "jbmono-latin.woff2"];
    if (!allowed.includes(req.params.name)) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
    res.setHeader("Content-Type", "font/woff2");
    res.send(fontFile(req.params.name));
  });

  // The single-page shell for the app's own routes. Signed-out visitors go to /signin.
  // Nothing outside the built assets and the API is ever served.
  const APP_ROUTES = [
    "/",
    "/signin",
    "/signup",
    "/explore",
    "/pipes",
    "/streams",
    "/pipelines",
    "/alerts",
    "/inbox",
    "/cases",
    "/traces",
    "/objectives",
    "/spaces",
    "/keys",
    "/rules",
  ];
  app.use((req: Request, res: Response) => {
    const path = req.path;
    const isAppRoute =
      req.method === "GET" &&
      (APP_ROUTES.includes(path) ||
        path.startsWith("/streams/") ||
        path.startsWith("/pipelines/") ||
        path.startsWith("/alerts/") ||
        path.startsWith("/cases/") ||
        path.startsWith("/traces/") ||
        path.startsWith("/assets/"));
    if (!isAppRoute) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
    if (path.startsWith("/assets/")) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(shellHtml());
  });

  const heartbeatMs = config().settings.sse_heartbeat_ms;
  const heartbeat = setInterval(() => {
    heartbeatAll();
    heartbeatTails();
  }, heartbeatMs);

  const server = app.listen(config().port, "0.0.0.0", () => {
    console.log(`Spoorline serving on 0.0.0.0:${config().port}`);
  });
  process.on("SIGTERM", () => {
    clearInterval(heartbeat);
    server.close(() => pool.end());
  });
}

function shellHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spoorline</title>
<style>
@font-face { font-family: "Inter"; src: url("/assets/fonts/inter-latin.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: "JetBrains Mono"; src: url("/assets/fonts/jbmono-latin.woff2") format("woff2"); font-weight: 100 800; font-display: swap; }
:root {
  --paper: #f8f5ee; --wash: #efe9dc; --surface: #e9e2d0; --border: #b9b09b; --hairline: #d8d1c0;
  --ink: #1e2420; --ink-2: #5c665d; --accent: #1e5d3a; --on-accent: #ffffff;
  --critical: #9c2f26; --warning: #9a6b1f; --healthy: #2c6e46; --info: #3f5f7a;
  --footer: #14201a; --footer-ink: #e8e3d6;
  --mono: "JetBrains Mono", ui-monospace, monospace;
  --sans: "Inter", system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: 15px; }
#root { min-height: 100vh; }
</style>
</head>
<body>
<div id="root"></div>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

/** A minimal multipart parser for one file part and text fields. */
function parseMultipart(req: Request, raw: Buffer): void {
  const type = String(req.headers["content-type"] ?? "");
  const m = /boundary=(.+)$/.exec(type);
  const body = req as unknown as { body: Record<string, unknown>; files?: Record<string, { name: string; data: Buffer }> };
  body.body = {};
  if (!m) return;
  const boundary = Buffer.from("--" + m[1]);
  let idx = raw.indexOf(boundary);
  const files: Record<string, { name: string; data: Buffer }> = {};
  while (idx !== -1) {
    const next = raw.indexOf(boundary, idx + boundary.length);
    if (next === -1) break;
    let part = raw.slice(idx + boundary.length, next);
    // strip leading CRLF and trailing CRLF
    if (part[0] === 13 && part[1] === 10) part = part.slice(2);
    if (part[part.length - 2] === 13 && part[part.length - 1] === 10) part = part.slice(0, -2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString("utf8");
      const content = part.slice(headerEnd + 4);
      const nameMatch = /name="([^"]+)"/.exec(headers);
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (fileMatch && headers.includes("Content-Disposition")) {
          files[fieldName] = { name: fileMatch[1], data: content };
        } else {
          body.body[fieldName] = content.toString("utf8");
        }
      }
    }
    idx = next;
  }
  if (Object.keys(files).length > 0) body.files = files;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
