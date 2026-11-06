// Page addresses: every published screen gets the app shell with the status the brief gives it
// (410 for a withdrawn yacht or an ended private page, 404 for anything unpublished).
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { one, pool } from "./db";
import { pageLive, type PageRow } from "./domain/pages";
import { sitemap } from "./routes/yachts";

const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");

const STAFF_PAGES = [
  /^\/w\/[^/]+\/(today|fleet|holds|charters|passages|passages\/new|berths|shore-power|brokers|tariffs)$/,
  /^\/w\/[^/]+\/(yachts|holds|charters|passages|berth-bookings)\/[^/]+$/,
  /^\/w\/[^/]+\/yachts\/[^/]+\/(profile|rota|stores|energy)$/,
  /^\/w\/[^/]+\/yachts\/[^/]+\/stores\/[^/]+$/,
];

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

let shell: Promise<string> | null = null;

async function pageStatus(path: string): Promise<number> {
  if (path === "/sign-in" || STAFF_PAGES.some((p) => p.test(path))) return 200;
  let match = /^\/fleet\/([^/]+)$/.exec(path);
  if (match) return (await one(pool, "SELECT 1 FROM workspaces WHERE slug = $1", [decodeURIComponent(match[1])])) ? 200 : 404;
  match = /^\/fleet\/([^/]+)\/([^/]+)$/.exec(path);
  if (match) {
    const yacht = await one<{ status: string }>(pool, "SELECT status FROM yachts WHERE workspace_slug = $1 AND slug = $2",
      [decodeURIComponent(match[1]), decodeURIComponent(match[2])]);
    return !yacht ? 404 : yacht.status === "withdrawn" ? 410 : 200;
  }
  match = /^\/(m|b)\/([^/]+)$/.exec(path);
  if (match) {
    const page = await one<PageRow>(pool, "SELECT * FROM private_pages WHERE token = $1 AND kind = $2",
      [decodeURIComponent(match[2]), match[1] === "m" ? "manifest" : "broker"]);
    return !page ? 404 : pageLive(page, Date.now()) ? 200 : 410;
  }
  return 404;
}

async function serveStatic(res: ServerResponse, path: string): Promise<boolean> {
  const relative = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const type = TYPES[extname(relative)];
  if (!type || !/^\/(assets|fonts)\//.test(relative)) return false;
  try {
    const data = await readFile(join(PUBLIC_DIR, relative));
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

export async function servePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }
  if (url.pathname === "/sitemap.xml") {
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : await sitemap());
    return;
  }
  if (url.pathname === "/") {
    // The front door names no workspace: send it to the sign-in screen.
    res.writeHead(302, { Location: "/sign-in", "Cache-Control": "no-store" });
    res.end();
    return;
  }
  if (await serveStatic(res, url.pathname)) return;
  shell ??= readFile(join(PUBLIC_DIR, "index.html"), "utf8");
  const status = await pageStatus(url.pathname);
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
  res.end(req.method === "HEAD" ? undefined : await shell);
}
