import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "./config.js";
import { applySchema } from "./db.js";
import { db } from "./db.js";
import { readBody, sendError, json, type Ctx, type Handler } from "./api/accounts.js";
import type { UploadedFile } from "./multipart.js";
import { accountRoutes } from "./api/accounts.js";
import {
  handleFolderListing,
  handleFolderCreate,
  handleFolderDelete,
  handleDrawingCreate,
  handleDrawingCopy,
  handleDrawingDelete,
  handleUpload,
  handleFileVersions,
  handleFileVersionDownload,
  handleOpened,
  handleRecent,
  handleSupportFiles,
  handleRestore,
} from "./api/files.js";
import { handleCommand, handleMeasure, handleActivity, handlePresencePost, handleDrawingGet } from "./api/drawings.js";
import {
  handleTraceCreate,
  handleTraceGet,
  handleTraceCommand,
  handleTraceSubmit,
  handleTraceClose,
  handleIssues,
  handleIssueResolve,
  handleShareCreate,
  handleShareList,
  handleInvite,
  handleRevoke,
  handleLinkInfo,
} from "./api/traces.js";
import {
  handleExportCreate,
  handleExportGet,
  handleExportList,
  handleExportDownload,
  handleRevisionList,
  handleRevisionCreate,
} from "./api/exports.js";
import { handleWorkspaceCreate, handleClockSet, handleClockClear } from "./api/grading.js";
import { drawingContext } from "./api/drawings.js";
import { loadAccountByCookie } from "./sessions.js";
import { addDrawingSubscriber, addAccountSubscriber, startRelay, syncState } from "./live.js";
import { valkeyState, minioState, mailState } from "./providers/state.js";
import { seedSampleFiles } from "./seeds.js";
import { ensureBucket, minioAvailable } from "./providers/minio.js";
import { valkeyAvailable } from "./providers/valkey.js";
import { startReevaluationLoop, startPresenceLoop } from "./presence.js";
import { activityFeed } from "./commit.js";

export interface RouteEntry {
  pattern: RegExp;
  handler: Handler;
}

function route(pattern: string, handler: Handler): RouteEntry {
  const source = pattern.replace(/:[^/]+/g, "([^/]+)");
  return { pattern: new RegExp(`^${source}$`), handler };
}

const routes: RouteEntry[] = [
  route("GET /api/health", async (ctx) => {
    const ok =
      valkeyState.available && minioState.available && mailState.available && (await postgresAvailable());
    json(ctx.res, 200, { status: ok ? "ok" : "unavailable" });
  }),
  route("POST /api/grading/workspaces", handleWorkspaceCreate),
  route("PUT /api/grading/workspaces/:id/clock", handleClockSet),
  route("DELETE /api/grading/workspaces/:id/clock", handleClockClear),
  route("POST /api/auth/signup", accountRoutes["POST /api/auth/signup"]),
  route("POST /api/auth/verify", accountRoutes["POST /api/auth/verify"]),
  route("POST /api/auth/verify/resend", accountRoutes["POST /api/auth/verify/resend"]),
  route("POST /api/auth/signin", accountRoutes["POST /api/auth/signin"]),
  route("POST /api/auth/signout", accountRoutes["POST /api/auth/signout"]),
  route("GET /api/me", accountRoutes["GET /api/me"]),
  route("POST /api/quotes", accountRoutes["POST /api/quotes"]),
  route("GET /api/folders/:id", handleFolderListing),
  route("POST /api/folders", handleFolderCreate),
  route("DELETE /api/folders/:id", handleFolderDelete),
  route("POST /api/drawings", handleDrawingCreate),
  route("POST /api/drawings/:id/copy", handleDrawingCopy),
  route("DELETE /api/drawings/:id", handleDrawingDelete),
  route("POST /api/folders/:id/uploads", handleUpload),
  route("GET /api/drawings/:id", handleDrawingGet),
  route("POST /api/drawings/:id/commands", handleCommand),
  route("POST /api/drawings/:id/measure", handleMeasure),
  route("GET /api/drawings/:id/activity", handleActivity),
  route("POST /api/drawings/:id/presence", handlePresencePost),
  route("GET /api/drawings/:id/events", handleDrawingEvents),
  route("GET /api/events", handleAccountEvents),
  route("GET /api/drawings/:id/file-versions", handleFileVersions),
  route("GET /api/drawings/:id/file-versions/:n/download", handleFileVersionDownload),
  route("POST /api/drawings/:id/file-versions/:n/restore", handleRestore),
  route("POST /api/drawings/:id/opened", handleOpened),
  route("GET /api/recent", handleRecent),
  route("GET /api/support-files", handleSupportFiles),
  route("POST /api/drawings/:id/traces", handleTraceCreate),
  route("GET /api/traces/:id", handleTraceGet),
  route("POST /api/traces/:id/commands", handleTraceCommand),
  route("POST /api/traces/:id/submit", handleTraceSubmit),
  route("POST /api/traces/:id/close", handleTraceClose),
  route("GET /api/drawings/:id/issues", handleIssues),
  route("POST /api/drawings/:id/issues/:n/resolve", handleIssueResolve),
  route("POST /api/drawings/:id/shares", handleShareCreate),
  route("GET /api/drawings/:id/shares", handleShareList),
  route("POST /api/shares/:id/invite", handleInvite),
  route("POST /api/shares/:id/revoke", handleRevoke),
  route("GET /api/links/:token", handleLinkInfo),
  route("POST /api/drawings/:id/exports", handleExportCreate),
  route("GET /api/drawings/:id/exports", handleExportList),
  route("GET /api/exports/:id", handleExportGet),
  route("GET /api/exports/:id/download", handleExportDownload),
  route("GET /api/templates/title-block-a3/revisions", handleRevisionList),
  route("POST /api/templates/title-block-a3/revisions", handleRevisionCreate),
];

async function postgresAvailable(): Promise<boolean> {
  try {
    await db.all(`select 1`);
    return true;
  } catch {
    return false;
  }
}

async function handleDrawingEvents(ctx: Ctx): Promise<void> {
  const drawingId = pathOf(ctx.req.url ?? "");
  const info = await drawingContext(ctx, drawingId, "read");
  startEventStream(ctx, (send, close) => {
    const stop = addDrawingSubscriber(drawingId, { send, close }, "drawing");
    send("sync", { state: syncState() });
    return stop;
  });
}

async function handleAccountEvents(ctx: Ctx): Promise<void> {
  if (!ctx.account) throw new Error("unauthenticated");
  const accountId = ctx.account.id;
  startEventStream(ctx, (send, close) => {
    const stop = addAccountSubscriber(accountId, { send, close });
    send("sync", { state: syncState() });
    return stop;
  });
}

function pathOf(url: string): string {
  const clean = url.split("?")[0];
  return clean.replace(/^\/api\/drawings\//, "").replace(/\/events$/, "");
}

function startEventStream(
  ctx: Ctx,
  attach: (send: (event: string, data: unknown) => void, close: () => void) => () => void,
): void {
  const { res } = ctx;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`retry: 1000\n\n`);
  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const close = (): void => {
    res.end();
  };
  const stop = attach(send, close);
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 5000);
  res.on("close", () => {
    clearInterval(heartbeat);
    stop();
  });
}

let staticRoot = "";

const apiPrefix = "/api/";

async function main(): Promise<void> {
  staticRoot = path.resolve("dist/client");
  await applySchema();
  await ensureBucket();
  await seedSampleFiles();
  startRelay();
  startReevaluationLoop();
  startPresenceLoop();
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (err) {
      sendError(res, err);
    }
  });
  server.listen(config.port, "0.0.0.0", () => {
    process.stdout.write(`Corbel Draft serving on ${config.port}\n`);
  });
  const providerLoop = setInterval(() => {
    void minioAvailable();
    void valkeyAvailable();
    void mailProbe();
  }, 5000);
  void providerLoop;
}

async function mailProbe(): Promise<void> {
  const { sendMail } = await import("./providers/mail.js");
  void sendMail;
  const { probeMail } = await import("./providers/state.js");
  await probeMail();
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const method = (req.method ?? "GET").toUpperCase();
  const origin = req.headers.origin;
  if (origin && config.publicUrl !== "" && !origin.startsWith(config.publicUrl)) {
    res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "forbidden" }));
    return;
  }
  const cookie = req.headers.cookie;
  const account = url.startsWith(apiPrefix) ? await loadAccountByCookie(cookie) : null;
  const linkToken = bearerToken(req.headers.authorization);
  const ctx: Ctx = { req, res, body: null, account, linkToken, actorName: account?.name ?? "", cookie };
  if (url.startsWith(apiPrefix)) {
    const match = routes.find((r) => r.pattern.test(`${method} ${url.split("?")[0]}`));
    if (match) {
      const groups = match.pattern.exec(`${method} ${url.split("?")[0]}`);
      if (url.startsWith("/api/folders/") && url.endsWith("/uploads") && method === "POST") {
        const { readMultipart } = await import("./multipart.js");
        ctx.uploads = await readMultipart(req, config.limits.UPLOAD_MAX_BYTES);
      } else if (method !== "GET" && method !== "DELETE") {
        ctx.body = await readBody(req, config.bodyLimitBytes);
      }
      await match.handler(ctx, ...(groups?.slice(1) ?? []));
      return;
    }
    if (url === "/api/health") {
      json(res, 200, { status: "unavailable" });
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  serveStatic(req, res);
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Link (.+)$/.exec(header.trim());
  return match ? match[1] : null;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = (req.url ?? "/").split("?")[0];
  const safePath = path.normalize(url).replace(/^(\.\.[/\\])+/, "");
  const target = path.join(staticRoot, safePath);
  if (!target.startsWith(staticRoot)) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (safePath.startsWith("/api")) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  // Never serve the run manifest, sources, lockfiles or environment files.
  const base = path.basename(safePath);
  const forbidden =
    base === "run.json" ||
    base.startsWith(".env") ||
    base === "package-lock.json" ||
    base === "package.json" ||
    base === "tsconfig.json" ||
    safePath.includes("src/") ||
    base.endsWith(".ts") ||
    base.endsWith(".tsx");
  if (forbidden) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  fs.stat(target, (err, stat) => {
    if (!err && stat.isFile()) {
      res.writeHead(200, { "content-type": contentTypeFor(target) });
      fs.createReadStream(target).pipe(res);
      return;
    }
    const index = path.join(staticRoot, "index.html");
    if (fs.existsSync(index)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      fs.createReadStream(index).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not built");
  });
}

function contentTypeFor(target: string): string {
  if (target.endsWith(".html")) return "text/html; charset=utf-8";
  if (target.endsWith(".css")) return "text/css; charset=utf-8";
  if (target.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (target.endsWith(".svg")) return "image/svg+xml";
  if (target.endsWith(".woff2")) return "font/woff2";
  if (target.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

main().catch((err) => {
  process.stderr.write(`${err}\n`);
  process.exit(1);
});
