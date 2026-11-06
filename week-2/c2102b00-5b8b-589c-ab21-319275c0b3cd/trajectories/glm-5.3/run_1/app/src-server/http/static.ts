import { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const PUBLIC_ROOT = resolve(process.cwd(), "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const SHELL = "index.html";

/** Serves only files inside public/, never source or data. */
export function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): boolean {
  const clean = decodeURIComponent(pathname);
  if (clean.includes("\0")) return false;
  const rel = normalize(clean).replace(/^([/\\.])+/, "");
  const abs = join(PUBLIC_ROOT, rel);
  if (abs !== PUBLIC_ROOT && !abs.startsWith(PUBLIC_ROOT + "/")) return false;

  let filePath: string;
  let isShell = false;
  try {
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      filePath = join(PUBLIC_ROOT, SHELL);
      isShell = true;
    } else {
      filePath = abs;
    }
  } catch {
    if (extname(clean) === "") {
      // App path: the shell page answers at the same address.
      filePath = join(PUBLIC_ROOT, SHELL);
      isShell = true;
    } else {
      return false;
    }
  }
  const ext = extname(filePath);
  const type = MIME[ext] ?? "application/octet-stream";
  const stat = statSync(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": String(stat.size),
    "Cache-Control": isShell || type.startsWith("text/html") ? "no-store" : "public, max-age=86400",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(filePath).pipe(res);
  return true;
}
