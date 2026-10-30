// One process serves the browser app and the API from the same origin.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { apiHandler, JSON_CAP, send, UPLOAD_CAP } from "./http";
import { bookingRoutes } from "./routes/bookings";
import { dialRoutes } from "./routes/dial";
import { documentRoutes } from "./routes/documents";
import { holdRoutes } from "./routes/holds";
import { hourPackRoutes } from "./routes/hourPacks";
import { invoiceRoutes } from "./routes/invoices";
import { policyRoutes } from "./routes/policy";
import { sessionRoutes } from "./routes/session";
import { shelfRoutes } from "./routes/shelves";
import { tenantRoutes } from "./routes/tenants";
import { prepareDatabase } from "./seed";
import { startSweeping } from "./sweep";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_DIRS = [join(APP_ROOT, "dist", "public"), join(APP_ROOT, "public")];
const SCREENS = /^\/(signin|bookings|documents|billing|tenants|settings|inspect\/[A-Za-z0-9_-]+)?$/;
const ASSET = /^\/(fonts\/)?[a-z0-9][a-z0-9.-]*\.(js|css|woff2|svg)$/;
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};
const PAGE_POLICY = "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const api = apiHandler([
  ...sessionRoutes,
  ...dialRoutes,
  ...holdRoutes,
  ...bookingRoutes,
  ...policyRoutes,
  ...hourPackRoutes,
  ...documentRoutes,
  ...tenantRoutes,
  ...shelfRoutes,
  ...invoiceRoutes,
]);

function readBody(req: http.IncomingMessage, cap: number): Promise<{ data: Buffer; tooLarge: boolean }> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= cap) chunks.push(chunk);
    });
    req.on("end", () => done({ data: Buffer.concat(chunks), tooLarge: size > cap }));
    req.on("error", fail);
  });
}

async function asset(path: string): Promise<{ body: Buffer; type: string } | null> {
  for (const dir of ASSET_DIRS) {
    const body = await readFile(join(dir, path)).catch(() => null);
    if (body) return { body, type: TYPES[extname(path)] };
  }
  return null;
}

async function page(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, { status: 404, file: { body: Buffer.from("Not found"), contentType: "text/plain; charset=utf-8" } });
    return;
  }
  const found = SCREENS.test(url.pathname) ? await asset("index.html") : ASSET.test(url.pathname) ? await asset(url.pathname) : null;
  if (!found) {
    send(res, { status: 404, file: { body: Buffer.from("Not found"), contentType: "text/plain; charset=utf-8" } });
    return;
  }
  res.setHeader("Content-Security-Policy", PAGE_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", url.pathname.startsWith("/fonts/") ? "public, max-age=31536000, immutable" : "no-cache");
  res.writeHead(200, { "Content-Type": found.type }).end(req.method === "HEAD" ? undefined : found.body);
}

const server = http.createServer((req, res) => {
  // Only the path and query matter; the base is a placeholder for URL parsing.
  const url = new URL(req.url ?? "/", "http://request.invalid");
  if (!url.pathname.startsWith("/api/")) {
    req.resume();
    page(req, res, url).catch((error: unknown) => {
      console.error(error);
      res.writeHead(500).end();
    });
    return;
  }
  const cap = url.pathname === "/api/documents" ? UPLOAD_CAP : JSON_CAP;
  readBody(req, cap)
    .then((body) => api(req, res, url, body))
    .catch((error: unknown) => {
      console.error(error);
      res.writeHead(500).end();
    });
});

await prepareDatabase(Date.now());
server.listen(config.port, "0.0.0.0", () => console.log(`Stationkeeper listening on 0.0.0.0:${config.port}`));
startSweeping();

process.on("SIGTERM", () => server.close(() => process.exit(0)));
