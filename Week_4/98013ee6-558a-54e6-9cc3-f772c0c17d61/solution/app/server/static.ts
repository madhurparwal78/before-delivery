import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../client");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function read(file: string): Promise<Buffer | null> {
  const resolved = path.resolve(ROOT, `.${file}`);
  if (!resolved.startsWith(`${ROOT}${path.sep}`)) return null;
  try {
    return await readFile(resolved);
  } catch {
    return null;
  }
}

/** Serves the built client; every path that is not a file is the app shell, which draws its own not-found view. */
/** Returns false when there is nothing to serve, so the caller answers with the one error helper. */
export async function serveClient(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const asset = pathname === "/" || pathname.endsWith("/") ? null : await read(pathname);
  const file = asset ?? (await read("/index.html"));
  if (!file) return false;
  const type = asset ? (TYPES[path.extname(pathname)] ?? "application/octet-stream") : TYPES[".html"];
  const immutable = asset !== null && pathname.startsWith("/assets/");
  res.writeHead(200, {
    "Content-Type": type ?? "application/octet-stream",
    "Content-Length": file.length,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : file);
  return true;
}
