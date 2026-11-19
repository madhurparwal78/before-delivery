// Serves only the built browser assets and the app shell; every other path answers 404.
import { readdirSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative, sep } from "node:path";
import { recordActivity, sessionOf } from "./pipeline.js";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

const SCREEN_PATHS = [/^\/$/, /^\/signin$/, /^\/join$/, /^\/account$/, /^\/desk$/, /^\/office$/, /^\/loans\/\d+$/, /^\/fees\/\d+$/];

export function staticFiles(root: string): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> {
  const files = new Map<string, { data: Buffer; type: string }>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        const ext = name.slice(name.lastIndexOf("."));
        if (TYPES[ext] && name !== "index.html") files.set(`/${relative(root, path).split(sep).join("/")}`, { data: readFileSync(path), type: TYPES[ext] });
      }
    }
  };
  walk(root);
  const shell = readFileSync(join(root, "index.html"));
  return async (req, res, url) => {
    const asset = files.get(url.pathname);
    if (asset && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "no-cache", ...SECURITY_HEADERS });
      res.end(req.method === "HEAD" ? undefined : asset.data);
      return;
    }
    const screen = SCREEN_PATHS.some((p) => p.test(url.pathname)) && req.method === "GET";
    if (screen) {
      // A full page load of a screen is activity on the session that made it.
      const session = await sessionOf(req, Date.now()).catch(() => null);
      if (session?.state === "active") await recordActivity(session.hash).catch(() => undefined);
    }
    res.writeHead(screen ? 200 : 404, { "Content-Type": TYPES[".html"]!, "Cache-Control": "no-store", ...SECURITY_HEADERS });
    res.end(shell);
  };
}
