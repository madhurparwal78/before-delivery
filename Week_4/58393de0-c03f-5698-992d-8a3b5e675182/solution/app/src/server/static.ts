import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { identify, SESSION_COOKIE } from "./auth";
import { databaseReady } from "./db";
import { ApiError } from "./errors";
import { decodePath, matchPath, readCookie, send } from "./http";
import { logged, nullIfMissing } from "./failures";

/** The built client sits next to the bundled server: `dist/server.js` and `dist/public`. */
const PUBLIC_ROOT = fileURLToPath(new URL("./public/", import.meta.url));

const PAGE_PATTERNS = [
  "/", "/signup", "/signin", "/verify", "/join", "/privacy", "/terms", "/student-data", "/dashboard", "/classrooms/:id",
  "/class", "/projects", "/editor/new", "/editor/:id",
];

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
};

const notFound = (res: ServerResponse) => send(res, { status: 404, body: new ApiError("not_found").toBody() });

async function servePage(req: IncomingMessage, pathname: string, res: ServerResponse): Promise<void> {
  const pending = databaseReady()
    && (await identify(readCookie(req.headers.cookie, SESSION_COOKIE)).catch(logged("session lookup for the shell", null)))?.kind === "pending";
  if (pending && pathname !== "/join") {
    res.writeHead(302, { Location: "/join", "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const html = await readFile(join(PUBLIC_ROOT, "index.html")).catch(nullIfMissing);
  if (!html) return notFound(res);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": html.length, "Cache-Control": "no-store" });
  res.end(req.method === "HEAD" ? undefined : html);
}

async function serveAsset(req: IncomingMessage, pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname.slice(1);
  const type = CONTENT_TYPES[extname(relative).toLowerCase()];
  if (!type || relative === "index.html" || relative.split("/").some((part) => part.startsWith("."))) return notFound(res);
  const file = join(PUBLIC_ROOT, relative);
  const info = file.startsWith(PUBLIC_ROOT) ? await stat(file).catch(nullIfMissing) : null;
  if (!info?.isFile()) return notFound(res);
  res.writeHead(200, {
    "Content-Type": type, "Content-Length": info.size,
    "Cache-Control": relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
  });
  if (req.method === "HEAD") res.end();
  else pipeline(createReadStream(file), res, () => undefined);
}

/** Pages are the built `index.html` for the client's own routes; assets come only from the built client. Everything else is 404. */
export async function serveStatic(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") return notFound(res);
  const pathname = decodePath(url.pathname);
  if (pathname === null) return notFound(res);
  if (PAGE_PATTERNS.some((pattern) => matchPath(pattern, pathname))) return servePage(req, pathname, res);
  return serveAsset(req, pathname, res);
}
