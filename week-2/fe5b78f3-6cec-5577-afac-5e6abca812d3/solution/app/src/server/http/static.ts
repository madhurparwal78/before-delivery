// The built web app. Only files under dist/client are served; every other path gets the app shell, with 404 for
// paths that are not screens, so sources, the manifest, lockfiles and environment files are never served.
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join } from "node:path";

const CLIENT_DIR = join(import.meta.dirname, "..", "..", "client");
const SCREENS = [/^\/$/, /^\/trains$/, /^\/book$/, /^\/bookings$/, /^\/bookings\/[^/]+$/, /^\/pnr$/, /^\/pnr\/[^/]+$/, /^\/signin$/, /^\/register$/];
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

export async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const asset = /^\/assets\/([\w.-]+)$/.exec(pathname);
  if (asset?.[1] && TYPES[extname(asset[1])]) {
    try {
      const body = await readFile(join(CLIENT_DIR, "assets", asset[1]));
      res.writeHead(200, {
        "Content-Type": TYPES[extname(asset[1])] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      res.end(body);
      return;
    } catch {
      // an unknown asset falls through to the not-found screen
    }
  }
  const shell = await readFile(join(CLIENT_DIR, "index.html"));
  res.writeHead(SCREENS.some((s) => s.test(pathname)) ? 200 : 404, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(shell);
}
