// Serves only the built frontend from dist/client; every page route answers with index.html.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./errors.js";
import { errorReply, writeReply } from "./pipeline.js";

const ROOT = fileURLToPath(new URL("../../client/", import.meta.url));
const PAGES = [/^\/$/, /^\/corridors$/, /^\/corridors\/[^/]+$/, /^\/review\/[^/]+$/];

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ktx2": "image/ktx2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

function notFound(res: ServerResponse): Promise<void> {
  return writeReply(res, errorReply(fail.notFound()));
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  if (req.method !== "GET" && req.method !== "HEAD") {
    await notFound(res);
    return;
  }
  const page = PAGES.some((p) => p.test(pathname));
  const relative = page ? "index.html" : normalize(pathname).replace(/^[/\\]+/, "");
  const file = join(ROOT, relative);
  if (!file.startsWith(ROOT) || relative.split(sep).some((part) => part.startsWith("."))) {
    await notFound(res);
    return;
  }
  const info = await stat(file).catch(() => null);
  if (info === null || !info.isFile()) {
    await notFound(res);
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": String(info.size),
    "cache-control": page ? "no-cache" : relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}
