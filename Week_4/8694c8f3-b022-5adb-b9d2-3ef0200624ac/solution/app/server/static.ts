import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { writeError, notFound } from "./errors.ts";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

/** The page and its script workers may only load from this origin or a blob made by the page itself. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const APP_ROUTES = [/^\/$/, /^\/sets\/[^/]+$/, /^\/join\/[^/]+$/, /^\/show\/[^/]+$/];

export async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    writeError(res, notFound());
    return;
  }
  let relative: string;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    writeError(res, notFound());
    return;
  }
  const page = APP_ROUTES.some((pattern) => pattern.test(relative));
  const target = normalize(join(WEB_ROOT, page ? "index.html" : relative));
  const inside = target.startsWith(WEB_ROOT + sep);
  const info = inside && !relative.includes("\0") ? await stat(target).catch(() => null) : null;
  if (!info?.isFile()) {
    writeError(res, notFound());
    return;
  }
  const body = await readFile(target);
  res.writeHead(200, {
    "content-type": TYPES[extname(target)] ?? "application/octet-stream",
    "content-length": body.length,
    "cache-control": page ? "no-cache" : "public, max-age=31536000, immutable",
    "content-security-policy": CONTENT_SECURITY_POLICY,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}
