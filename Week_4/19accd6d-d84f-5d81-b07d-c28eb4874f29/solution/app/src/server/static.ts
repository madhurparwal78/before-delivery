import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { notFound, sendError } from "./errors";

const ROOT = join(__dirname, "public");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

/** Serves the built frontend. Any path without a file extension is a screen of the single page app. */
export async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const requested = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const isAsset = extname(requested) !== "";
  const file = isAsset ? join(ROOT, requested) : join(ROOT, "index.html");
  if (!file.startsWith(ROOT)) return sendError(res, notFound());
  try {
    const bytes = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    res.end(bytes);
  } catch {
    sendError(res, notFound());
  }
}
