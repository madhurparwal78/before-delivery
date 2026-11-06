// Swathdeck server: applies the schema and seed, then serves the API and the built browser app.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { connect, migrate } from "./db.js";
import { ClientGone, notFound, sendError } from "./http.js";
import { startMailWorker } from "./mail.js";
import { startLinkMonitor } from "./monitor.js";
import { kickReports, startReportWorker } from "./report.js";
import { router } from "./routes.js";
import { seed } from "./seed.js";
import { startStatusChecks } from "./status.js";

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Screen addresses get the app shell with 200; any other address gets it with 404 (the not-found page). */
const SCREEN = /^\/(sign-in|fleet(\/[\w-]+)?|missions(\/new|\/[\w-]+(\/plan|\/history)?)?|launch|flags|surveys(\/[\w-]+)?)?$/;

let shell: Buffer | null = null;

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const security = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(404, { ...security, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const file = path.normalize(path.join(CLIENT, pathname));
  const isAsset = /^\/((assets|fonts)\/[\w.-]+|favicon\.svg)$/.test(pathname) && file.startsWith(CLIENT + path.sep) && existsSync(file) && statSync(file).isFile();
  if (isAsset) {
    res.writeHead(200, { ...security, "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable", "Content-Length": String(statSync(file).size) });
    createReadStream(file).pipe(res);
    return;
  }
  const last = pathname.split("/").pop() ?? "";
  if (last.includes(".") || pathname.includes("/.")) {
    res.writeHead(404, { ...security, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  shell ??= readFileSync(path.join(CLIENT, "index.html"));
  res.writeHead(SCREEN.test(pathname) ? 200 : 404, { ...security, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(req.method === "HEAD" ? undefined : shell);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://swathdeck.local");
  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
    serveStatic(req, res, url.pathname);
    return;
  }
  try {
    const found = router.match(req.method ?? "GET", url.pathname);
    if (!found) {
      req.resume();
      throw notFound();
    }
    await found.handler({ req, res, params: found.params, query: url.searchParams });
  } catch (error) {
    if (error instanceof ClientGone) {
      res.destroy();
      return;
    }
    sendError(res, error);
  }
}

async function main(): Promise<void> {
  await connect();
  await migrate();
  await seed();
  startStatusChecks();
  startLinkMonitor();
  startMailWorker();
  startReportWorker();
  kickReports();
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => sendError(res, error));
  });
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.listen(config.port, "0.0.0.0", () => console.log(`Swathdeck listening on ${config.port}`));
}

main().catch((error) => {
  console.error("Swathdeck could not start:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
