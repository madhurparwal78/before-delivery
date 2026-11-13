import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { routes } from "./api.js";
import { ANONYMOUS, callerOf } from "./auth.js";
import { config } from "./config.js";
import { listen as listenToLedger } from "./ledger.js";
import { now, poll } from "./core.js";
import { runDue } from "./due.js";
import { createRouter, handleApi, send, sendError } from "./http.js";
import { fail } from "./errors.js";
import { sendDueNotices } from "./notices.js";
import { renderPage } from "./pages.js";
import { migrate } from "./schema.js";
import { startStreams } from "./streams.js";
import { SWEEP_MS, buildLedger, sweep } from "./sweep.js";

const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public");
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" };
const route = createRouter(routes);

async function serveStatic(pathname: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!pathname.startsWith("/assets/") && !pathname.startsWith("/fonts/")) return null;
  const file = normalize(join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR) || !TYPES[extname(file)]) return null;
  try {
    return { bytes: await readFile(file), type: TYPES[extname(file)] as string };
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      const match = route(req.method ?? "GET", url.pathname);
      if (!match) return sendError(res, fail("not_found"));
      return handleApi(req, res, url, match, config.testClock);
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const asset = await serveStatic(url.pathname);
      if (asset) return send(res, { status: 200, bytes: asset.bytes, type: asset.type, headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
      try {
        const caller = await callerOf(req.headers.cookie, await now()).catch(() => ANONYMOUS);
        const page = await renderPage(url, caller);
        return send(res, { status: page.status, bytes: Buffer.from(page.html), type: "text/html; charset=utf-8" });
      } catch (error) {
        console.error(error);
        return send(res, { status: 500, bytes: Buffer.from("Something went wrong on our side."), type: "text/plain; charset=utf-8" });
      }
    }
    return sendError(res, fail("not_found"));
  })();
});
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

process.on("unhandledRejection", (reason) => console.error("unhandled rejection", reason));
process.on("uncaughtException", (error) => console.error("uncaught exception", error));

let busy = false;
const every = (ms: number, work: () => Promise<void>): void => {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    work()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, ms).unref();
};

async function boot(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      break;
    } catch (error) {
      if (!busy) console.error("waiting for Postgres:", (error as Error).message);
      busy = true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await poll();
  await buildLedger(false);
  listenToLedger(() => void poll());
  startStreams();
  every(400, poll);
  every(250, async () => runDue(await now()));
  every(1000, sendDueNotices);
  every(SWEEP_MS, sweep);
  void sweep();
}

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Malhar Key-On listening on ${config.port}`);
  void boot();
});
