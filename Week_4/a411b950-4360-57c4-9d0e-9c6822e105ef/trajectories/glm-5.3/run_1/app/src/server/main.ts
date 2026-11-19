import { IncomingMessage, ServerResponse, createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { loadConfig, AppConfig } from "./config.js";
import { Database } from "./database.js";
import { applyMigrations } from "./schema.js";
import { Seeder } from "./seed.js";
import { Storage, StorageUnavailable, stemKey, attachmentKey } from "./storage.js";
import { KillBill, KillBillUnavailable } from "./killbill.js";
import { Mailer } from "./mailer.js";
import { MailQueue, MailKind } from "./mail-queue.js";
import { Store } from "./store.js";
import { AppError, crossOrigin, methodNotAllowed, notFound, payloadTooLarge } from "./errors.js";
import { Router, RouteContext, readCookies } from "./http-core.js";
import { parseMultipart } from "./multipart.js";
import {
  isAcceptableReference,
  isWavOrOggAudioStem,
  isSafeFilename,
  looksLikeWav,
  oggDurationMs,
  readWavInfo,
  wavDurationMs,
} from "./media-sniff.js";
import { verifyPassword, sha256Hex } from "./crypto.js";
import { displayAddress } from "./mailer.js";
import {
  CREDIT_LABELS,
  CreditType,
  LAYERS,
  Layer,
  Station,
  StationStem,
  milestoneSplit,
  formatMoney,
  Milestone,
} from "../shared/domain.js";
import { isBareAddress, isMultiLineText, isSingleLineText, charCount } from "../shared/text-rules.js";
import { formatInstant, localCalendarDate, monthLabel } from "../shared/dates.js";
import { publicApi } from "./routes/public.js";
import { proposalApi } from "./routes/proposals.js";
import { consoleApi } from "./routes/console.js";
import { Context } from "./context.js";

/**
 * Earshot server. Binds 0.0.0.0 on APP_PUBLIC_PORT (default 4173), serves the
 * built front end, the API and stored media, and nothing else (DP-43, DP-44).
 */

const PUBLIC_DIR = resolve(process.cwd(), "public");
const FRONTEND_DIR = resolve(process.cwd(), "frontend");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

export interface Earshot {
  config: AppConfig;
  db: Database;
  storage: Storage;
  killbill: KillBill;
  mailer: Mailer;
  mailQueue: MailQueue;
  store: Store;
  seeder: Seeder;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Database(config);
  const storage = new Storage(config);
  const killbill = new KillBill(config);
  const mailer = new Mailer(config);
  const mailQueue = new MailQueue(db, mailer, config);
  const store = new Store(db, config, killbill);
  const seeder = new Seeder(db, storage, config);
  const app: Earshot = { config, db, storage, killbill, mailer, mailQueue, store, seeder };

  const router = new Router();
  const context: Context = { app, router };

  // The schema and seeds are applied idempotently; a database outage does not
  // stop the server from starting (DP-44).
  const startUp = async () => {
    if (await db.ping()) {
      await applyMigrations(db);
      await seeder.seed();
    }
  };
  await startUp();
  const reconnectTimer = setInterval(() => {
    void (async () => {
      if (await db.ping()) {
        await applyMigrations(db);
        await seeder.seed();
      }
    })().catch(() => undefined);
  }, 5000);
  reconnectTimer.unref();
  mailQueue.start();
  const sweepTimer = setInterval(() => {
    void mailQueue.sweepExpiredProposals().catch(() => undefined);
  }, 1000);
  sweepTimer.unref();

  publicApi(context);
  proposalApi(context);
  consoleApi(context);

  const server = createServer((request, response) => {
    void handle(app, router, request, response).catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      }
      response.end(JSON.stringify({ error: "internal_error", message: "Something went wrong." }));
      if (!(error instanceof AppError)) {
        console.error("Unhandled error", error instanceof Error ? error.message : error);
      }
    });
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`Earshot listening on 0.0.0.0:${config.port}`);
  });

  const shutdown = () => {
    mailQueue.stop();
    seeder.stop();
    clearInterval(reconnectTimer);
    clearInterval(sweepTimer);
    server.close(() => {
      void db.close();
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const JSON_LIMIT = 65536;
const ENQUIRY_LIMIT = 10500000;
const STEM_LIMIT = 20500000;

async function handle(
  app: Earshot,
  router: Router,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const path = url.pathname;

  // Nothing with a traversal segment is ever served (DP-44).
  if (path.includes("..") || decodeURIComponent(path).includes("..")) {
    return sendError(response, notFound());
  }

  const isApi = path === "/api" || path.startsWith("/api/");
  const method = request.method || "GET";
  const isStateChange = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  // Origin check: state changes from another origin answer 403 (DP-44).
  if (isStateChange) {
    const origin = request.headers.origin;
    if (origin && origin !== app.config.publicUrl) {
      return sendError(response, crossOrigin());
    }
  }

  // Unknown method on a known path answers 405 before anything else; unknown
  // paths fall through to the static handler and 404.
  const match = router.match(method, path);
  if (match === "method_not_allowed" && !isApi) {
    return serveStatic(response, path, app);
  }
  if (match === "method_not_allowed") {
    return sendError(response, methodNotAllowed());
  }
  if (match === "not_found") {
    if (!isApi) {
      return serveStatic(response, path, app);
    }
    return sendError(response, notFound());
  }

  // Size limits are enforced before the body is parsed (DP-44).
  const limit = requestLimit(path, isApi);
  const declaredLength = Number(request.headers["content-length"] || "0");
  if (declaredLength > limit) {
    return sendError(response, payloadTooLarge());
  }

  // The match above already handled method_not_allowed and not_found; only a
  // successful match reaches the body read.
  const chunks: Buffer[] = [];
  let received = 0;
  let tooLarge = false;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    request.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) {
        tooLarge = true;
        request.removeAllListeners("data");
        request.removeAllListeners("end");
        request.removeAllListeners("error");
        resolvePromise();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolvePromise());
    request.on("error", (error) => rejectPromise(error));
  });
  if (tooLarge) {
    return sendError(response, payloadTooLarge());
  }

  const routeContext: RouteContext = {
    request,
    response,
    params: match.params,
    query: url.searchParams,
    body: Buffer.concat(chunks),
    cookies: readCookies(request.headers.cookie),
    ip: clientIp(request),
  };

  try {
    const result = (await match.handler(routeContext)) as HandlerResult | undefined;
    if (result === undefined) return;
    if (result.kind === "media") {
      response.writeHead(result.status, result.headers);
      response.end(result.body ?? undefined);
      return;
    }
    if (result.kind === "text") {
      response.writeHead(result.status, {
        "Content-Type": result.contentType,
        ...(result.headers || {}),
      });
      response.end(result.body);
      return;
    }
    if (result.kind === "redirect" || result.kind === "empty") {
      response.writeHead(result.status, result.headers || {});
      response.end();
      return;
    }
    response.writeHead(result.status, {
      "Content-Type": "application/json; charset=utf-8",
      ...result.headers,
    });
    response.end(JSON.stringify(result.body));
  } catch (error) {
    if (error instanceof AppError) {
      sendError(response, error);
      return;
    }
    throw error;
  }
}

function requestLimit(path: string, isApi: boolean): number {
  if (!isApi) return JSON_LIMIT;
  if (path === "/api/enquiries") return ENQUIRY_LIMIT;
  if (/^\/api\/console\/projects\/[^/]+\/stems$/.test(path)) return STEM_LIMIT;
  if (/^\/api\/console\/projects\/[^/]+\/links$/.test(path)) return JSON_LIMIT;
  return JSON_LIMIT;
}

function clientIp(request: IncomingMessage): string {
  const socket = request.socket;
  return socket.remoteAddress || "";
}

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string | number>;
  kind?: "media" | "text" | "redirect" | "empty" | "json";
  contentType?: string;
}

export function sendError(response: ServerResponse, error: AppError): void {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  for (const [key, value] of Object.entries(error.extras)) {
    body[key] = value;
  }
  const headers: Record<string, string | number> = { "Content-Type": "application/json; charset=utf-8" };
  if (error.code === "rate_limited" && typeof error.extras.retry_after_seconds === "number") {
    headers["Retry-After"] = error.extras.retry_after_seconds as number;
  }
  if (error.status === 405 && error.code === "read_only") {
    headers.Allow = "GET";
  }
  response.writeHead(error.status, headers);
  response.end(JSON.stringify(body));
}

/**
 * Serves the built front end and its assets. Only the SPA entry points, hashed
 * assets, fonts and icons are served; source files, run.json, .env and
 * package.json answer 404 (DP-44).
 */
function serveStatic(response: ServerResponse, path: string, app: Earshot): void {
  if (isProtectedPath(path)) {
    return sendError(response, notFound());
  }
  const candidates = staticCandidates(path);
  for (const candidate of candidates) {
    const filePath = join(PUBLIC_DIR, candidate);
    if (!filePath.startsWith(PUBLIC_DIR)) continue;
    if (!existsSync(filePath)) continue;
    const stat = statSync(filePath);
    if (!stat.isFile()) continue;
    const type = MIME_TYPES[extname(filePath)] || "application/octet-stream";
    const body = readFileSync(filePath);
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": isImmutable(candidate) ? "public, max-age=31536000, immutable" : "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (body.length > 0) response.end(body);
    else response.end();
    return;
  }
  // SPA routes fall back to their own entry page; API paths never get HTML.
  if (path.startsWith("/api")) {
    return sendError(response, notFound());
  }
  let entryName: string | null = null;
  if (path === "/" || path === "") entryName = "index.html";
  else if (path === "/console") entryName = "console.html";
  else if (/^\/listen\/[^/]+$/.test(path)) entryName = "listen.html";
  else if (/^\/p\/[^/]+$/.test(path)) entryName = "proposal.html";
  if (entryName) {
    const entry = join(PUBLIC_DIR, entryName);
    if (existsSync(entry)) {
      const body = readFileSync(entry);
      const headers: Record<string, string | number> = {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      };
      if (entryName === "listen.html") {
        // Private listening pages are never cached and never leak referrers
        // (DP-48).
        headers["Cache-Control"] = "no-store";
      }
      response.writeHead(200, headers);
      response.end(body);
      return;
    }
  }
  return sendError(response, notFound());
}

function isProtectedPath(path: string): boolean {
  const protectedFiles = [
    "/run.json",
    "/.env",
    "/package.json",
    "/package-lock.json",
    "/tsconfig.json",
    "/THIRD_PARTY_NOTICES.md",
    "/AGENTS.md",
  ];
  const lower = path.toLowerCase();
  if (protectedFiles.includes(lower)) return true;
  if (lower.startsWith("/src/") || lower.startsWith("/server/") || lower.startsWith("/scripts/")) return true;
  if (lower.startsWith("/dist/")) return true;
  if (lower.startsWith("/frontend/")) return true;
  if (lower.startsWith("/node_modules/")) return true;
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".map")) return true;
  if (lower.startsWith("/.git")) return true;
  return false;
}

function staticCandidates(path: string): string[] {
  if (path === "/" || path === "") return ["index.html"];
  const clean = path.replace(/^\/+/, "");
  return [clean, join(clean, "index.html")];
}

function isImmutable(candidate: string): boolean {
  return candidate.startsWith("assets/") && /\.[0-9a-f]{8,}\./.test(candidate);
}

main().catch((error) => {
  console.error("Failed to start Earshot:", error instanceof Error ? error.message : error);
  process.exit(1);
});
