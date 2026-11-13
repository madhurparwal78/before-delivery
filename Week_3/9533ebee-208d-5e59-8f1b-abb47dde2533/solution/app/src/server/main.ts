import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { inLedger, isReady, prepareDatabase } from "./db.js";
import { fail, problemResponse } from "./errors.js";
import { deliverQueuedEvents } from "./events.js";
import { handleApi, type PublicRoute } from "./http.js";
import { deliverQueuedNotices } from "./notices.js";
import { pollOracle } from "./oracle.js";
import { renderQueuedPdfs } from "./pdf.js";
import { sync } from "./positions.js";
import { memberPublicRoutes, memberRoutes } from "./routes/members.js";
import { ledgerRoutes } from "./routes/ledger.js";
import { marketRoutes } from "./routes/market.js";
import { liquidityRoutes } from "./routes/liquidity.js";
import { swapRoutes } from "./routes/swaps.js";
import { positionRoutes } from "./routes/positions.js";
import { settlementRoutes } from "./routes/settlements.js";
import { SCHEMA } from "./schema.js";
import { seed } from "./seed.js";
import { watchBucket } from "./storage.js";
import { watchApplication } from "./svix.js";
import { serverNow } from "./time.js";

// One origin: the built browser app and the API. Nothing outside dist/client is ever served.

const CLIENT_ROOT = fileURLToPath(new URL("../../client/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const routes = [...memberRoutes, ...ledgerRoutes, ...marketRoutes, ...liquidityRoutes, ...swapRoutes, ...positionRoutes, ...settlementRoutes];
const publicRoutes: PublicRoute[] = [
  {
    method: "GET",
    pattern: /^\/api\/health$/,
    handler: async () => (isReady() ? { status: 200, body: { status: "ok" } } : { status: 503, body: { status: "starting" } }),
  },
  ...memberPublicRoutes,
];

type Served = { status: 200; type: string; body: Buffer; immutable: boolean } | null;

/** A built file, or the app shell for a path with no file extension; null for a file that is not in the build. */
async function serveClient(pathname: string): Promise<Served> {
  const decoded = decodeURIComponent(pathname);
  const lastSegment = decoded.slice(decoded.lastIndexOf("/") + 1);
  if (!lastSegment.includes(".")) return { status: 200, type: TYPES[".html"] ?? "", body: await readFile(join(CLIENT_ROOT, "index.html")), immutable: false };
  const candidate = normalize(join(CLIENT_ROOT, decoded));
  const type = TYPES[extname(candidate)];
  if (!candidate.startsWith(CLIENT_ROOT) || decoded.includes(`${sep}..`) || type === undefined) return null;
  const info = await stat(candidate).catch(() => null);
  if (!info?.isFile()) return null;
  return { status: 200, type, body: await readFile(candidate), immutable: decoded.startsWith("/assets/") };
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    void handleApi(req, res, routes, publicRoutes);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    problemResponse(res, fail("not_found"), { Allow: "GET, HEAD" });
    return;
  }
  serveClient(pathname)
    .then((served) => {
      if (served === null) {
        problemResponse(res, fail("not_found"));
        return;
      }
      res.writeHead(served.status, {
        "Content-Type": served.type,
        "Cache-Control": served.immutable ? "public, max-age=31536000, immutable" : "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : served.body);
    })
    .catch(() => problemResponse(res, fail("not_found")));
});

server.listen(config.port, "0.0.0.0", () => console.log(`Quillmoor Reserve listening on 0.0.0.0:${config.port}`));

/** Runs `job` on its own timer, one run at a time; a failed run is reported and tried again on the next tick. */
function every(seconds: number, name: string, job: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running || !isReady()) return;
    running = true;
    job()
      .catch((error: unknown) => console.error(`${name} deferred:`, error instanceof Error ? error.message : error))
      .finally(() => {
        running = false;
      });
  }, seconds * 1000);
}

// Interest, grace, staleness, notices, PDFs, webhooks and oracle rounds follow the server clock: every process runs
// each job on its own timer, whatever requests arrive, and the database claims make each item run exactly once.
void prepareDatabase(SCHEMA, seed).then(() => {
  watchBucket();
  watchApplication();
  every(2, "background evaluation", () => inLedger((tx) => sync(tx, serverNow()).then(() => undefined)));
  every(2, "notice delivery", deliverQueuedNotices);
  every(2, "webhook delivery", deliverQueuedEvents);
  every(2, "PDF rendering", renderQueuedPdfs);
  every(config.oracle.pollSeconds, "oracle poll", () => pollOracle());
});
