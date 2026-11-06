import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./env.ts";
import { initClock } from "./clock.ts";
import { initPool, poolRef, isDatabaseOk } from "./db.ts";
import { ApiError } from "./errors.ts";
import { writeJson, writeError, parseCookies, crossOriginCheck, requireJsonContentType } from "./http.ts";
import { handleApiRequest, statusBody } from "./api.ts";
import { handleEventsEndpoint, startDispatchLoop } from "./dispatch.ts";
import { initMail, countHeld } from "./mail.ts";
import { initStorage, ensureBucket } from "./storage.ts";
import * as jobs from "./jobs.ts";
import { listenForEvents } from "./events.ts";
import { applySchemaAndSeed, registerWorkspaces } from "./setup.ts";
import { loadPerson } from "./scope.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const JSON_LIMIT = 1_000_000;
const UPLOAD_LIMIT = 10_000_000 + 64 * 1024;

const MIME: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};

const HTML_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tallyroom</title>
<link rel="icon" href="/assets/icons/lucide-circle.svg" type="image/svg+xml">
</head>
<body>
<div id="root"></div>
<script src="/assets/app.js"></script>
</body>
</html>`;

async function main(): Promise<void> {
  const cfg = loadConfig();
  initClock(cfg.serverClockStart);
  initPool(cfg.databaseUrl);
  initMail(cfg);
  initStorage(cfg);
  await ensureBucket(cfg).catch(() => undefined);

  // Schema and seed, retried until the database answers.
  void applySchemaAndSeed(cfg).catch((e) => {
    console.error("startup setup failed:", e instanceof Error ? e.message : e);
    const retry = setInterval(() => {
      applySchemaAndSeed(cfg)
        .then(() => clearInterval(retry))
        .catch(() => undefined);
    }, 5000);
  });

  // Kill Bill registration, retried until it succeeds.
  void registerWorkspaces(cfg).catch(() => undefined);

  void listenForEvents(poolRef()).catch(() => undefined);
  startDispatchLoop(poolRef(), cfg);
  jobs.startBackgroundJobs(poolRef(), cfg);

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, cfg);
    } catch {
      if (!res.writableEnded) {
        writeJson(res, 500, { error: { code: "database_unavailable", message: "The database is unreachable." } });
      }
    }
  });
  server.listen(cfg.port, "0.0.0.0", () => {
    console.log(`tallyroom serving on 0.0.0.0:${cfg.port}`);
  });
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: ReturnType<typeof loadConfig>
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  // Same-origin rule for state-changing requests.
  const origin = req.headers.origin;
  const originError = crossOriginCheck(req, origin);
  if (originError) {
    writeError(res, originError);
    return;
  }

  if (pathname === "/api/health") {
    writeJson(res, 200, { status: "ok" });
    return;
  }

  if (pathname === "/api/status") {
    // The status endpoint answers while the database is down, so it never touches it first.
    let isOwner: boolean | null = null;
    let held: number | null = null;
    if (isDatabaseOk()) {
      try {
        const person = await loadSessionPerson(req);
        if (person && person.role === "owner") {
          isOwner = true;
          held = await countHeld();
        } else {
          isOwner = false;
        }
      } catch {
        isOwner = null;
      }
    }
    writeJson(res, 200, statusBody(cfg, isOwner, held));
    return;
  }

  if (pathname.startsWith("/api/")) {
    if (!isDatabaseOk()) {
      // The database check comes before authentication and replay.
      writeJson(res, 503, { error: { code: "database_unavailable", message: "The database is unreachable." } });
      return;
    }
    if (pathname === "/api/events" && (req.method ?? "GET").toUpperCase() === "GET") {
      const person = await loadSessionPerson(req);
      if (!person) {
        writeJson(res, 401, { error: { code: "unauthenticated", message: "Sign in again." } });
        return;
      }
      await handleEventsEndpoint(req, res, cfg, person);
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const rawBody = await readBody(req, pathname);
    if (rawBody instanceof ApiError) {
      writeError(res, rawBody);
      return;
    }
    if (rawBody.length > 0 && !isUploadPath(pathname)) {
      const ctError = requireJsonContentType(req);
      if (ctError) {
        writeError(res, ctError);
        return;
      }
    }
    await handleApiRequest(req, res, cfg, rawBody, cookies);
    return;
  }

  serveStatic(res, pathname);
}

function isUploadPath(pathname: string): boolean {
  return /\/api\/(issues|messages|docs)\/[^/]+\/attachments$/.test(pathname);
}

async function loadSessionPerson(req: http.IncomingMessage) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["tr_session"];
  if (!token) return null;
  const { withClient } = await import("./db.ts");
  return withClient(async (client) => {
    const session = await client.query<{ person_id: string }>("SELECT person_id FROM sessions WHERE token = $1", [token]);
    if (session.rows.length === 0) return null;
    return loadPerson(client, session.rows[0].person_id);
  });
}

async function readBody(req: http.IncomingMessage, pathname: string): Promise<Buffer | ApiError> {
  const limit = isUploadPath(pathname) ? UPLOAD_LIMIT : JSON_LIMIT;
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) {
    return new ApiError("too_large", "The request body is too large.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      return new ApiError("too_large", "The request body is too large.");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Only built browser assets and the app shell are served; everything else answers 404. */
function serveStatic(res: http.ServerResponse, pathname: string): void {
  if (pathname.startsWith("/assets/")) {
    const file = path.resolve(publicDir, `.${pathname}`);
    if (file.startsWith(publicDir) && existsSync(file) && statSync(file).isFile()) {
      const ext = path.extname(file).toLowerCase();
      const data = readFileSync(file);
      res.writeHead(200, {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(data);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  // File-like paths (run.json, package manifests, source files, env files) never serve.
  const last = pathname.split("/").pop() ?? "";
  if (last.includes(".")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  // The app shell for every workspace route.
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  res.end(HTML_SHELL);
}

void main();
