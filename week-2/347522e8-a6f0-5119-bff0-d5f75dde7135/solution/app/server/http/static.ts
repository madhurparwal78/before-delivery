// Serves only the built browser assets. The app's screens answer with index.html; every other
// path (source, configuration, manifests, lockfiles, .env, anything outside the build) is a 404.

import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../client/", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const SCREENS = [/^\/$/, /^\/apply$/, /^\/board$/, /^\/kitchen$/, /^\/operator$/, /^\/shift$/, /^\/share\/[A-Za-z0-9_-]+$/];

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

const CSP = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

async function fileAt(path: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const resolved = normalize(join(ROOT, decoded));
  if (!resolved.startsWith(ROOT) || resolved.split(sep).some((part) => part.startsWith("."))) return null;
  try {
    return (await stat(resolved)).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  const screen = SCREENS.some((pattern) => pattern.test(path));
  const file = screen ? join(ROOT, "index.html") : path.startsWith("/assets/") ? await fileAt(path) : null;
  if (!file || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": screen ? "no-cache" : "public, max-age=31536000, immutable",
    ...(screen ? { "Content-Security-Policy": CSP } : {}),
  });
  res.end(req.method === "HEAD" ? undefined : body);
}
