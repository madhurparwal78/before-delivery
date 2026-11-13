// Serves only the built browser assets and the app page for the published screen paths.

import { readdirSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { SECURITY_HEADERS } from "./headers.js";
import { fileURLToPath } from "node:url";

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "client");

const TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const SCREENS = [/^\/$/, /^\/signin$/, /^\/apply$/, /^\/board$/, /^\/packs$/, /^\/documents$/, /^\/tenants$/,
  /^\/tenants\/[^/]+$/, /^\/report$/, /^\/receipt\/[^/]+$/];

const PAGE_HEADERS = { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };

function listAssets(): Map<string, Buffer> {
  const assets = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== "index.html" && TYPES[path.extname(entry.name)]) {
        assets.set(`/${path.relative(CLIENT_DIR, full).split(path.sep).join("/")}`, readFileSync(full));
      }
    }
  };
  walk(CLIENT_DIR);
  return assets;
}

const assets = listAssets();
const page = readFileSync(path.join(CLIENT_DIR, "index.html"));

export function serveStatic(pathname: string, res: ServerResponse): void {
  const asset = assets.get(pathname);
  if (asset) {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": TYPES[path.extname(pathname)] ?? "application/octet-stream",
      "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    }).end(asset);
  } else if (SCREENS.some((screen) => screen.test(pathname))) {
    res.writeHead(200, PAGE_HEADERS).end(page);
  } else {
    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}
