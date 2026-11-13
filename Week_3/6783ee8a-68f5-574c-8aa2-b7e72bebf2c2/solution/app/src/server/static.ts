import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { errorBody, notFound } from "./errors";

const ROOT = join(__dirname, "public");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** The screens of the single page app. Anything else without a file is a 404. */
const SCREENS = [/^\/$/, /^\/signin$/, /^\/signup$/, /^\/verify\/[^/]+$/, /^\/invite\/[^/]+$/, /^\/notebooks$/, /^\/notebooks\/[^/]+$/];

/** The page is cross-origin isolated so the kernel can be interrupted through shared memory. */
const ISOLATION = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
};

function missing(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(errorBody(notFound()));
}

/** Serves the built frontend; only files under build/public and the app's screens are ever served. */
export async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return missing(res);
  }
  if (decoded.split("/").some((part) => part.startsWith(".")) || decoded.includes("\u0000")) return missing(res);
  const isAsset = extname(decoded) !== "";
  if (!isAsset && !SCREENS.some((screen) => screen.test(decoded))) return missing(res);
  const file = isAsset ? join(ROOT, normalize(decoded)) : join(ROOT, "index.html");
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache", ...ISOLATION });
    res.end(bytes);
  } catch {
    missing(res);
  }
}
