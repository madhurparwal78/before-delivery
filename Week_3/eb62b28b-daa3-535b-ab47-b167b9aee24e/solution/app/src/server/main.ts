// Boot: listen at once, retry Postgres until the schema is ready, then keep the background work running.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { matchScreen } from "../shared/routes";
import { runErasures } from "./closure";
import { config } from "./config";
import { ApiError, errorBody } from "./errors";
import { pipeline, writeError, writeUnexpected } from "./http";
import { deliverPendingMail } from "./mail";
import { uploadCatalogIfMissing } from "./killbill";
import { provisionSeededPlus, reconcileWithKillBill } from "./membership";
import { routes } from "./routes";
import { applySchema } from "./schema";
import { seedStartingData } from "./seed";
import { readSession } from "./sessions";
import { ensureBucket, StoreUnavailable } from "./store";

const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

let ready = false;

const answerApi = pipeline(routes, readSession);

function sendFile(response: ServerResponse, path: string, status: number): void {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
  });
  createReadStream(path).pipe(response);
}

function serveBrowser(url: URL, response: ServerResponse): void {
  const wanted = normalize(join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  const isAsset = wanted.startsWith(PUBLIC_DIR + sep) && extname(wanted) !== "" && existsSync(wanted) && statSync(wanted).isFile();
  if (isAsset) {
    sendFile(response, wanted, 200);
    return;
  }
  sendFile(response, join(PUBLIC_DIR, "index.html"), matchScreen(url.pathname) ? 200 : 404);
}

async function onRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const target = request.url ?? "/";
  if (!URL.canParse(target, config.publicUrl)) {
    request.resume();
    sendFile(response, join(PUBLIC_DIR, "index.html"), 404);
    return;
  }
  const url = new URL(target, config.publicUrl);
  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
    try {
      serveBrowser(url, response);
    } catch {
      sendFile(response, join(PUBLIC_DIR, "index.html"), 404);
    }
    return;
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  if (!ready) {
    request.resume();
    writeError(response, new ApiError(503, "starting", "The desk is starting."));
    return;
  }
  await answerApi(request, response, url);
}

// Each background job waits for its own previous run and logs what it could not do.
function every(ms: number, job: () => Promise<void>): void {
  const run = (): void => {
    job()
      .catch((error: unknown) => {
        if (!(error instanceof ApiError || error instanceof StoreUnavailable)) console.error(error);
      })
      .finally(() => setTimeout(run, ms));
  };
  run();
}

async function bootDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await seedStartingData();
      return;
    } catch (error) {
      console.error("waiting for postgres:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const MAIL_EVERY_MS = 1000;
const ERASURE_EVERY_MS = 1000;
const FIRST_START_EVERY_MS = 5000;
const KILL_BILL_CHECK_EVERY_MS = 30000;
const BUCKET_EVERY_MS = 5000;

const server = createServer((request, response) => {
  onRequest(request, response).catch((error: unknown) => writeUnexpected(response, error));
});
server.on("clientError", (_error, socket) => {
  const body = JSON.stringify(errorBody(new ApiError(400, "bad_request", "That request could not be read.")));
  socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
});
server.listen(config.publicPort, "0.0.0.0");

await bootDatabase();
ready = true;

every(MAIL_EVERY_MS, deliverPendingMail);
every(ERASURE_EVERY_MS, runErasures);
every(FIRST_START_EVERY_MS, async () => {
  await uploadCatalogIfMissing();
  await provisionSeededPlus();
});
every(KILL_BILL_CHECK_EVERY_MS, reconcileWithKillBill);

let bucketReady = false;
every(BUCKET_EVERY_MS, async () => {
  if (bucketReady) return;
  await ensureBucket();
  bucketReady = true;
});
