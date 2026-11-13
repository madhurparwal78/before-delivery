import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** The screens the single page serves: sign-in and home, billing, and a booking deep link. */
const SCREEN = /^\/(?:billing|bookings\/\d+)?$/;

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "same-origin",
};

function notFound(response: ServerResponse): void {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
  response.end("Not found");
}

/** Serves the built front end and its bundled fonts; nothing else on disk is reachable. */
export async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return notFound(response);
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://relayline.invalid").pathname);
  } catch {
    return notFound(response);
  }
  const isScreen = SCREEN.test(pathname);
  const relative = isScreen ? "index.html" : pathname.slice(1);
  const hidden = relative.split("/").some((segment) => segment.startsWith(".") || segment === "..");
  const extension = path.extname(relative);
  if (hidden || extension === ".map" || !(extension in CONTENT_TYPES)) return notFound(response);
  try {
    const file = await readFile(path.join(WEB_ROOT, relative));
    const immutable = relative.startsWith("assets/");
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "content-length": String(file.length),
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ...SECURITY_HEADERS,
    });
    response.end(method === "HEAD" ? undefined : file);
  } catch {
    notFound(response);
  }
}
