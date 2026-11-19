import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { findLinkStay } from "./checkin";
import { decodeSegment } from "./http";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "client");
const PAGES = new Set(["/", "/desk", "/board", "/guests", "/rates", "/reports"]);
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml" };

const SECURITY_HEADERS = {
  "Content-Security-Policy": "img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-cache",
};

function notFound(res: ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
  res.end("Not found.");
}

async function sendFile(res: ServerResponse, file: string, status = 200): Promise<void> {
  const body = await readFile(file).catch(() => null);
  if (!body) return notFound(res);
  res.writeHead(status, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Content-Length": body.length, ...SECURITY_HEADERS });
  res.end(body);
}

/** The single-page shell for the published routes, the bundle files, and 404 for everything else. */
export async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const link = /^\/checkin\/([^/]+)$/.exec(pathname);
  if (link) return sendFile(res, path.join(ROOT, "index.html"), (await findLinkStay(decodeSegment(link[1] ?? ""))) ? 200 : 404);
  if (PAGES.has(pathname)) return sendFile(res, path.join(ROOT, "index.html"));
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(`${ROOT}${path.sep}`) || !/^\/assets\/[\w.-]+$/.test(pathname)) return notFound(res);
  return sendFile(res, file);
}
