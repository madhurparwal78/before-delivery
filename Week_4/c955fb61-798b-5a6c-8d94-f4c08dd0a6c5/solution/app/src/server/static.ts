import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sessionPerson } from "./auth";

const clientRoot = fileURLToPath(new URL("../client", import.meta.url));
const PUBLIC_PAGES = new Set(["/", "/signin", "/signup"]);
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, status = 200): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  const immutable = file.includes(`${path.sep}assets${path.sep}`) || file.includes(`${path.sep}fonts${path.sep}`);
  res.writeHead(status, {
    "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : await readFile(file));
  return true;
}

/** Built client files, and the one page shell for the app's pages; a signed-out visitor is sent to sign in. */
export async function handleStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const target = path.join(clientRoot, path.normalize(url.pathname));
  if (path.extname(url.pathname) && target.startsWith(clientRoot)) {
    if (!(await sendFile(req, res, target))) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
    return;
  }
  const person = await sessionPerson(req);
  if (!person && !PUBLIC_PAGES.has(url.pathname)) {
    res.writeHead(302, { location: `/signin?next=${encodeURIComponent(url.pathname + url.search)}` });
    res.end();
    return;
  }
  if (!(await sendFile(req, res, path.join(clientRoot, "index.html")))) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("The client has not been built.");
  }
}
