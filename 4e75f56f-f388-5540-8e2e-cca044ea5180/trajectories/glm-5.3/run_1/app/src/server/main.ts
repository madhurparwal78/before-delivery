import express from "express";
import type { Request, Response, NextFunction } from "express";
import { loadConfig, JSON_BODY_LIMIT } from "./config.js";
import { applySchema } from "./db.js";
import { KillBill } from "./killbill.js";
import { S3 } from "./s3.js";
import { ApiError, errorBody } from "./errors.js";
import { makeAuthRouter } from "./authRoutes.js";
import { makeHoldsRouter } from "./holdsRoutes.js";
import { makePaymentsRouter } from "./paymentRoutes.js";
import { makeReservationsRouter } from "./reservationRoutes.js";
import { makeDeskRouter } from "./deskRoutes.js";
import { makeCheckinRouter } from "./checkinRoutes.js";
import { makeContentRouter } from "./contentRoutes.js";
import { PocketBase } from "./pocketbase.js";
import { seed } from "./seed.js";
import { Jobs } from "./jobs.js";
import type { PaymentContext } from "./payments.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const cfg = loadConfig();
const kb = new KillBill(cfg);
const s3 = new S3(cfg);
const pb = new PocketBase(cfg);
const ctx: PaymentContext = { cfg, kb, s3 };

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const indexHtml = existsSync(join(publicDir, "index.html")) ? readFileSync(join(publicDir, "index.html"), "utf8") : "<!doctype html><title>Opaline Bench Days</title>";

const app = express();
app.disable("x-powered-by");

/**
 * The origin check: a state-changing request whose Origin header is present
 * and differs from the app's own origin (the host this request came through)
 * is refused before any other check.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    const host = req.headers.host;
    const expected = host ? `${req.headers["x-forwarded-proto"] ?? "http"}://${host}` : cfg.appOrigin;
    const same = o_origin(origin) === o_origin(expected) || o_origin(origin) === o_origin(cfg.appOrigin);
    if (!same) {
      res.status(403).json({ error: "cross_origin", message: "That request did not come from this site." });
      return;
    }
  }
  next();
});

function o_origin(u: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
}

/** The one JSON body limit: 65,536 bytes, and exactly that is allowed. */
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType.startsWith("multipart/form-data")) {
    next();
    return;
  }
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > JSON_BODY_LIMIT) {
    res.status(413).json({ error: "payload_too_large", message: "That request is too large." });
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let done = false;
  req.on("data", (chunk: Buffer) => {
    if (done) return;
    size += chunk.length;
    if (size > JSON_BODY_LIMIT) {
      done = true;
      chunks.length = 0;
      res.status(413).json({ error: "payload_too_large", message: "That request is too large." });
      req.pause();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (done) return;
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.length === 0) {
      (req as unknown as { body: unknown }).body = {};
      next();
      return;
    }
    try {
      (req as unknown as { body: unknown }).body = JSON.parse(raw);
    } catch {
      res.status(400).json({ error: "malformed_json", message: "That request body is not valid JSON." });
      return;
    }
    next();
  });
  req.on("error", () => {
    if (!done) {
      done = true;
    }
  });
});

// Unsupported media types for JSON endpoints are refused after auth in each
// route; the API takes application/json and multipart only.

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api", makeAuthRouter(cfg));
app.use("/api", makeHoldsRouter(cfg));
app.use("/api", makePaymentsRouter(cfg, ctx));
app.use("/api", makeReservationsRouter(cfg, ctx));
app.use("/api", makeDeskRouter(cfg, ctx));
app.use("/api", makeCheckinRouter(cfg));
app.use("/api", makeContentRouter(cfg, pb));

// API 404 — every API error uses the one JSON error shape.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "not_found", message: "Nothing here." });
});

// The one JSON error shape, with the one precedence order.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json(errorBody(err));
    return;
  }
  console.error("unhandled error:", err);
  res.status(500).json({ error: "internal", message: "Something went wrong on our side." });
});

// Static assets from the app origin; source, config and dotfiles never serve.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  const path = decodeURIComponent(req.path);
  if (path.includes("..") || path.startsWith("/.") || /\/\./.test(path)) {
    res.status(404).send(notFoundPage());
    return;
  }
  const known = ["/", "/account", "/desk", "/desk/content", "/checkin"];
  if (known.includes(path)) {
    res.status(200).type("html").send(indexHtml);
    return;
  }
  const safe = path === "/" ? "/index.html" : path;
  const file = join(publicDir, safe);
  if (!file.startsWith(publicDir) || !existsSync(file)) {
    res.status(404).send(notFoundPage());
    return;
  }
  res.sendFile(file);
});

function notFoundPage(): string {
  return indexHtml;
}

const jobs = new Jobs(cfg, ctx);

async function boot(): Promise<void> {
  // The app serves even when dependencies are down; the schema, bucket,
  // collections and staff seed are applied idempotently on every serve.
  applySchema().catch(() => undefined);
  s3.ensureBucket().catch(() => undefined);
  seed(cfg, pb).catch(() => undefined);
  jobs.start();
}

boot().then(() => {
  app.listen(cfg.port, "0.0.0.0", () => {
    console.log(`Opaline Bench Days serving on 0.0.0.0:${cfg.port}`);
  });
});
