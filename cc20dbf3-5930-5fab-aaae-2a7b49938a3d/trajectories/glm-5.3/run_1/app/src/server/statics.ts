import { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ASSET_ROOT = join(process.cwd(), "public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Paths that are never served: sources, manifests, configuration and anything outside the asset folder. */
const DENIED_PREFIXES = ["/.env", "/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/src/", "/dist/", "/node_modules/", "/.git"];

/** A path that is never served, whether or not a file happens to sit behind it. */
export function isDeniedPath(path: string): boolean {
  const decoded = safeDecode(path);
  if (decoded === null) return true;
  if (decoded.includes("..") || decoded.includes("\0")) return true;
  return DENIED_PREFIXES.some((denied) => decoded === denied || decoded.startsWith(denied));
}

export async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  if (isDeniedPath(path)) return false;
  const decoded = safeDecode(path);
  if (decoded === null) return false;
  const candidate = normalize(join(ASSET_ROOT, decoded));
  if (!candidate.startsWith(ASSET_ROOT)) return false;
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return false;
    const data = await readFile(candidate);
    const type = CONTENT_TYPES[extname(candidate).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": data.length,
      "Cache-Control": decoded.startsWith("/fonts/") ? "public, max-age=604800" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

export async function serveIndex(res: ServerResponse): Promise<void> {
  const data = await readFile(join(ASSET_ROOT, "index.html"));
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(data);
}

function safeDecode(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
