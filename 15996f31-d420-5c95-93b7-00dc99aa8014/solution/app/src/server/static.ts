// Serves only the built browser bundle (dist/client). Source, manifests, lockfiles, node_modules and env files
// are outside that folder, so they answer 404.

import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../client/", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const PAGE_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

const SPA = /^\/($|desk(\/.*)?$|inspect\/[^/]+$)/;

function notFound(res: ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...PAGE_HEADERS });
  res.end("Not found");
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") return notFound(res);
  const isPage = SPA.test(path);
  const relative = isPage ? "index.html" : normalize(path).replace(/^[/\\]+/, "");
  if (!isPage && !relative.startsWith(`assets${sep}`) && relative !== "favicon.svg") return notFound(res);
  try {
    const body = await readFile(ROOT + relative);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(relative)] ?? "application/octet-stream",
      "Cache-Control": isPage ? "no-cache" : "public, max-age=31536000, immutable",
      ...PAGE_HEADERS,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    notFound(res);
  }
}
