// Pages and built browser assets from one origin (brief: Server boundary, Never served). Only files under the
// built client directory are served; known screens get the app shell; everything else is 404.
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { notFound, sendError } from "./http.js";

const ROOT = fileURLToPath(new URL("../../client/", import.meta.url));
const SCREENS = new Set(["/", "/sign-in", "/drive", "/recent", "/shared", "/bin", "/handovers", "/settings"]);
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const PAGE_SECURITY = {
  "content-security-policy": "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
};

let shell: Buffer | null = null;

export async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") throw notFound();
    if (SCREENS.has(url.pathname)) {
      shell ??= await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...PAGE_SECURITY });
      res.end(req.method === "HEAD" ? undefined : shell);
      return;
    }
    const type = TYPES[extname(url.pathname)];
    let path: string;
    try {
      path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    } catch {
      throw notFound();
    }
    if (!type || !url.pathname.startsWith("/assets/") || !path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) throw notFound();
    const data = await readFile(path).catch(() => {
      throw notFound();
    });
    res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    sendError(res, error);
  }
}
