import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { startErasureRetries } from "./handlers/consignors";
import { handleApi, publishRoutes } from "./pipeline";
import { ROUTES } from "./routes";
import { prepareDatabase } from "./schema";
import { ensureBucket } from "./storage";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_DIRS = [join(ROOT, "public"), join(ROOT, "dist", "client")];
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

/** Every screen route the app publishes; any other address gets the not-found screen with status 404. */
const SCREENS: readonly RegExp[] = [
  /^\/$/,
  /^\/sign-in$/,
  /^\/pieces\/[^/]+$/,
  /^\/h\/[^/]+$/,
  /^\/c\/[^/]+$/,
  /^\/appointments$/,
  /^\/appointments\/cancel\/[^/]+$/,
  /^\/staff\/(pieces|till|holds|appointments|consignors|ladder|payouts|import|sales-book|members)$/,
  /^\/staff\/(pieces|sales|holds|consignors|payouts)\/[^/]+$/,
];

async function readStatic(path: string): Promise<Buffer | null> {
  const relative = normalize(path.replace(/^\/assets\//, ""));
  if (relative.startsWith("..")) return null;
  for (const dir of STATIC_DIRS) {
    const bytes = await readFile(join(dir, relative)).catch(() => null);
    if (bytes) return bytes;
  }
  return null;
}

await prepareDatabase();
await ensureBucket().catch(() => console.warn("Storage is not reachable yet; each storage call tries again."));
publishRoutes(ROUTES);
startErasureRetries();

const shell = await readFile(join(ROOT, "public", "index.html"));

createServer((request, response) => {
  const address = `http://localhost${request.url}`;
  if (!URL.canParse(address)) {
    response.writeHead(400).end();
    return;
  }
  const url = new URL(address);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    void handleApi(request, response, url);
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    void readStatic(url.pathname).then((bytes) => {
      response.writeHead(bytes ? 200 : 404, { "Content-Type": bytes ? (TYPES[extname(url.pathname)] ?? "application/octet-stream") : "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
      response.end(bytes ?? "Not found");
    });
    return;
  }
  response.writeHead(SCREENS.some((screen) => screen.test(url.pathname)) ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(shell);
}).listen(config.port, "0.0.0.0", () => console.log(`Ourlet Consignment Desk on port ${config.port}`));
