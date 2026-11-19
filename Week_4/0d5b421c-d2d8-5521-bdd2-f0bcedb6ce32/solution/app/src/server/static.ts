// The built browser app: only files inside dist/client, never source, maps, dotfiles or the manifest.
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../client");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function respond(res: http.ServerResponse, status: number, type: string, body: Buffer | string, immutable = false): void {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(body);
}

export function serveStatic(method: string, pathname: string, res: http.ServerResponse): void {
  if (method !== "GET") {
    respond(res, 404, "text/plain; charset=utf-8", "Not found");
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    respond(res, 404, "text/plain; charset=utf-8", "Not found");
    return;
  }
  const requested = path.resolve(ROOT, `.${decoded}`);
  const inside = requested.startsWith(`${ROOT}${path.sep}`) && !path.relative(ROOT, requested).split(path.sep).some((part) => part.startsWith("."));
  const extension = path.extname(requested);
  if (inside && extension in TYPES && fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    respond(res, 200, TYPES[extension] ?? "application/octet-stream", fs.readFileSync(requested), pathname.startsWith("/assets/") || pathname.startsWith("/fonts/"));
    return;
  }
  if (path.extname(pathname) !== "") {
    respond(res, 404, "text/plain; charset=utf-8", "Not found");
    return;
  }
  respond(res, 200, TYPES[".html"] ?? "text/html", fs.readFileSync(path.join(ROOT, "index.html")));
}
