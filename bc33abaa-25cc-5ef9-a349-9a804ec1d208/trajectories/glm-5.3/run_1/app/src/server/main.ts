import express, { type Request, type Response, type NextFunction, type Express } from "express";
import { randomBytes } from "node:crypto";
import cookieParser from "cookie";
import { pool, applySchema } from "./db";
import { initServices, services } from "./services";
import { loadEnv } from "./env";
import { errorHandler, errors, HttpError } from "./http";
import { authRouter, workspaceRouter, dashboardRouter } from "./routes/auth";
import { membersRouter, invitesPublicRouter, tokensRouter } from "./routes/members";
import { scenesRouter } from "./routes/scenes";
import { realtimeRouter, commentsRouter, commentPatchRouter, mentionRouter } from "./routes/realtime";
import { versionsRouter, versionActionsRouter, exportsRouter, thumbnailRouter } from "./routes/versions";
import { reviewLinksRouter, reviewPublicRouter } from "./routes/review";
import { billingRouter } from "./routes/billing";
import { webhookRouter } from "./routes/webhook";
import { assetsRouter } from "./routes/assets";
import { auditRouter, exportDownloadRouter, embedPublicRouter } from "./routes/audit";
import { startScheduler } from "./scheduler";
import { applySeed } from "./seed";
import { resolveCaller } from "./auth";
import { publishVersion } from "./realtime";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const env = loadEnv();
initServices(env);

const LIMIT_GENERAL = 1_000_000;
const LIMIT_ASSETS = 20_100_000;
const LIMIT_THUMBNAIL = 1_000_000;

function rawBody(limit: number): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("aborted", () => {
      aborted = true;
    });
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        res.status(413).json({ error: "payload_too_large", limitBytes: limit });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      (req as Request & { rawBody: Buffer }).rawBody = Buffer.concat(chunks);
      next();
    });
  };
}

function jsonFromBody(req: Request): unknown {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw || raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw errors.validation({ body: "Invalid JSON" });
  }
}

const app = express();
app.disable("x-powered-by");

// The client bundle is served from src/client/public whether running from
// dist (bundled) or from source.
const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../src/client/public");

// Origin check for state-changing requests.
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  const origin = req.headers.origin;
  const isPublicGetRoute =
    req.path.startsWith("/api/review") || req.path.startsWith("/review") || req.path.startsWith("/api/embed") || req.path.startsWith("/embed");
  if (method === "GET" || method === "HEAD" || method === "OPTIONS" || isPublicGetRoute) {
    next();
    return;
  }
  if (typeof origin === "string" && origin.length > 0) {
    const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const host = req.headers.host ?? "";
    const own = `${proto}://${host}`;
    let publicOrigin = "";
    try {
      publicOrigin = new URL(env.publicUrl).origin;
    } catch {
      publicOrigin = own;
    }
    if (origin !== own && origin !== publicOrigin) {
      res.status(403).json({ error: "cross_origin" });
      return;
    }
  }
  next();
});

// Body handling with per-route limits.
app.use((req, res, next) => {
  const path = req.path;
  if (req.method === "POST" && path === "/api/assets") {
    rawBody(LIMIT_ASSETS)(req, res, () => {
      const parsed = multipartParse((req as Request & { rawBody: Buffer }).rawBody, req.headers["content-type"]);
      if (parsed) {
        (req as Request & { file?: { originalname: string; buffer: Buffer; mimetype: string } }).file = parsed.file;
        req.body = parsed.fields;
      } else {
        req.body = {};
      }
      next();
    });
    return;
  }
  if (req.method === "PUT" && /^\/api\/versions\/[^/]+\/thumbnail$/.test(path)) {
    rawBody(LIMIT_THUMBNAIL)(req, res, () => {
      req.body = {};
      next();
    });
    return;
  }
  if (req.path.startsWith("/api/")) {
    rawBody(LIMIT_GENERAL)(req, res, () => {
      if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") {
        req.body = {};
        next();
        return;
      }
      if (req.path === "/api/billing/webhook") {
        next();
        return;
      }
      try {
        req.body = jsonFromBody(req);
      } catch (e) {
        return next(e);
      }
      next();
    });
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }
  rawBody(LIMIT_GENERAL)(req, res, () => {
    try {
      req.body = jsonFromBody(req);
    } catch (e) {
      return next(e);
    }
    next();
  });
});

app.use((req, _res, next) => {
  const raw = req.headers.cookie;
  req.cookies = raw ? (cookieParser.parse(raw) as Record<string, string>) : {};
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Public auth and signup
app.use("/api", authRouter);

// Members, invitations, agent tokens
app.use("/api/members", membersRouter);
app.use("/api", invitesPublicRouter);
app.use("/api/agent-tokens", tokensRouter);

// Workspace, dashboard
app.use("/api/workspace", workspaceRouter);
app.use("/api/dashboard", dashboardRouter);

// Scenes: mounts under /api/scenes with nested realtime/comment/mention routes
app.use("/api/scenes", realtimeRouter);
app.use("/api/scenes", scenesRouter);
app.use("/api/scenes", commentsRouter);
app.use("/api/scenes", mentionRouter);

// Comments patch
app.use("/api", commentPatchRouter);

// Versions and exports
app.use("/api/scenes", versionsRouter);
app.use("/api/versions", versionActionsRouter);
app.use("/api", thumbnailRouter);
app.use("/api/versions", exportsRouter);
app.use("/api/exports", exportDownloadRouter);

// Review links (mounted at /api for both version and link paths)
app.use("/api", reviewLinksRouter);
app.use("/api", reviewPublicRouter);

// Billing (the signed webhook mounts first so it is not caught by billing auth)
app.use("/api", webhookRouter);
app.use("/api/billing", billingRouter);

// Assets
app.use("/api/assets", assetsRouter);

// Audit
app.use("/api/audit", auditRouter);

// Public embed data
app.use("/api", embedPublicRouter);

// Static client assets
app.use(express.static(CLIENT_DIR, { fallthrough: true, index: false, maxAge: "1h" }));

// Never serve source, manifests or config files.
const BLOCKED = ["/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/THIRD_PARTY_NOTICES.md"];
app.use((req, res, next) => {
  const path = req.path;
  if (
    BLOCKED.some((b) => path === b) ||
    path.startsWith("/src/") ||
    path.startsWith("/dist/") ||
    path.endsWith(".ts") ||
    path.endsWith(".map") ||
    path.startsWith("/.env") ||
    path.startsWith("/node_modules/")
  ) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
});

// Page routes
const indexHtml = join(CLIENT_DIR, "index.html");
app.get(/^\/(app|app\/.*)$/, (req, res) => {
  if (!existsSync(indexHtml)) {
    res.status(500).send("client not built");
    return;
  }
  res.sendFile(indexHtml);
});
app.get("/", (req, res) => {
  res.sendFile(indexHtml);
});
app.get(/^\/(pricing|signup|login|invite\/[^/]+|review\/[^/]+|embed\/[^/]+)$/, (req, res) => {
  res.sendFile(indexHtml);
});

// API 404
app.use("/api", (req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.use(errorHandler);

function multipartParse(raw: Buffer, contentType: string | undefined): { fields: Record<string, string>; file: { originalname: string; buffer: Buffer; mimetype: string } } | null {
  if (!contentType || !contentType.startsWith("multipart/form-data")) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return null;
  const delim = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: { originalname: string; buffer: Buffer; mimetype: string } | null = null;
  let index = raw.indexOf(delim);
  while (index !== -1) {
    const next = raw.indexOf(delim, index + delim.length);
    if (next === -1) break;
    let part = raw.subarray(index + delim.length, next);
    if (part[0] === 13 && part[1] === 10) part = part.subarray(2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      let body = part.subarray(headerEnd + 4);
      if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) body = body.subarray(0, body.length - 2);
      const headers: Record<string, string> = {};
      for (const line of headerText.split("\r\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
      }
      const disposition = headers["content-disposition"] ?? "";
      const nameMatch = /name="([^"]*)"/.exec(disposition);
      const fileNameMatch = /filename="([^"]*)"/.exec(disposition);
      if (nameMatch) {
        if (fileNameMatch) {
          file = { originalname: fileNameMatch[1]!, buffer: body, mimetype: headers["content-type"] ?? "application/octet-stream" };
        } else {
          fields[nameMatch[1]!] = body.toString("utf8");
        }
      }
    }
    index = next;
  }
  if (!file) return null;
  return { fields, file };
}

async function main(): Promise<void> {
  // Wait for PostgreSQL: health requires it.
  for (let attempt = 0; ; attempt++) {
    try {
      await applySchema();
      break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await applySeed();
  startScheduler();

  // Connect to each dependency once it first becomes reachable.
  const connect = async (name: string, fn: () => Promise<void>): Promise<void> => {
    for (;;) {
      try {
        await fn();
        console.log(`[orrery] ${name} connected`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  void connect("file-storage", async () => {
    if (!(await services.storage.check())) throw new Error("unreachable");
  });
  void connect("killbill", async () => {
    if (!(await services.killbill.ping())) throw new Error("unreachable");
    await services.killbill.uploadCatalog();
  });
  void connect("pocketbase", async () => {
    await services.pocketbase.ensureCollections();
  });
  void connect("mailpit", async () => {
    if (!(await services.mailer.check())) throw new Error("unreachable");
    await services.mailer.flush();
  });

  app.listen(env.port, "0.0.0.0", () => {
    console.log(`[orrery] serving on port ${env.port}`);
  });
}

void main();
