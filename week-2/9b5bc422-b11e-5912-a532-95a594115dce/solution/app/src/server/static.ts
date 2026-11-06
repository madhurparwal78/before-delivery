import { createReadStream, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const PUBLIC_DIR = join(import.meta.dirname, "public");
const SHELL = join(PUBLIC_DIR, "index.html");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function builtAsset(pathname: string): string | null {
  try {
    const file = normalize(join(PUBLIC_DIR, decodeURIComponent(pathname)));
    return file.startsWith(PUBLIC_DIR + sep) && statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** Serves a built asset, or the app for any other path. */
export function serveAsset(res: ServerResponse, pathname: string): void {
  const asset = builtAsset(pathname);
  const file = asset ?? SHELL;
  const cache = asset && pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
}
