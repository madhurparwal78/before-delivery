import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isKnownPath } from "./landing.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "public");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const SECURITY = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

async function send(res: ServerResponse, status: number, file: string, cache: string): Promise<void> {
  const body = await readFile(file);
  res.writeHead(status, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": cache,
    ...SECURITY,
  });
  res.end(body);
}

/** Serves only the built client assets; every other path gets the app shell or a plain not-found. */
export async function serveClient(pathname: string, res: ServerResponse): Promise<void> {
  const extension = extname(pathname);
  if (extension) {
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root + sep)) return missing(res);
    try {
      await send(res, 200, file, extension === ".woff2" ? "public, max-age=86400" : "no-cache");
    } catch {
      missing(res);
    }
    return;
  }
  try {
    await send(res, isKnownPath(pathname.replace(/\/+$/, "") || "/") ? 200 : 404, join(root, "index.html"), "no-cache");
  } catch {
    missing(res);
  }
}

function missing(res: ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}
