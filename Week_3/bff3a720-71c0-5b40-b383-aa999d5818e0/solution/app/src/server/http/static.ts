import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { PageConfig } from "../../shared/api";
import { isPagePath } from "../../shared/routes";
import { config } from "../config";

const CLIENT_DIR = path.join(__dirname, "client");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** index.html with the two values the page may know. */
function indexHtml(): string {
  const pageConfig: PageConfig = { toastSeconds: config.toastSeconds, searchDebounceMs: config.searchDebounceMs };
  const attribute = JSON.stringify(pageConfig).replace(/"/g, "&quot;");
  return readFileSync(path.join(CLIENT_DIR, "index.html"), "utf8").replace('name="longseat-config" content=""', `name="longseat-config" content="${attribute}"`);
}

let page: string | null = null;

function sendPage(res: ServerResponse, status: number): void {
  page ??= indexHtml();
  // The moment this shell is served: the page's event stream asks for everything published since (see live.ts).
  const bytes = Buffer.from(page.replace('name="longseat-live-from" content=""', `name="longseat-live-from" content="${Date.now()}"`));
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-length": bytes.length, "cache-control": "no-cache", ...SECURITY_HEADERS });
  res.end(bytes);
}

/** Built assets and the single-page app shell; unknown paths get the shell with status 404 so the app shows its own not-found page. */
export function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  if (pathname !== "/" && pathname !== "/index.html") {
    const target = path.normalize(path.join(CLIENT_DIR, decodeURIComponent(pathname)));
    const extension = path.extname(target);
    if (target.startsWith(CLIENT_DIR + path.sep) && extension in TYPES) {
      try {
        if (statSync(target).isFile()) {
          const bytes = readFileSync(target);
          const immutable = pathname.startsWith("/assets/") || pathname.startsWith("/fonts/");
          res.writeHead(200, {
            "content-type": TYPES[extension] as string,
            "content-length": bytes.length,
            "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
            ...SECURITY_HEADERS,
          });
          res.end(req.method === "HEAD" ? undefined : bytes);
          return;
        }
      } catch {
        // not a built asset: fall through to the page shell
      }
    }
  }
  sendPage(res, pathname === "/index.html" || !isPagePath(pathname) ? 404 : 200);
}
