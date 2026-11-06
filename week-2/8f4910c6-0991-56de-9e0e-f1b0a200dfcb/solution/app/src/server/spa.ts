// The browser app's files and its HTML shell. Only built files under dist/public are ever served.

import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { one, pool } from "./db.js";
import { ApiError } from "./errors.js";
import { errorReply, send } from "./http.js";

const PUBLIC = new URL("./public/", import.meta.url);
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

const PAGES = [
  /^\/$/, /^\/boards$/, /^\/boards\/(women|men|creators|new-faces)$/, /^\/talent\/[^/]+$/, /^\/tray$/, /^\/cast-request$/,
  /^\/p\/[^/]+$/, /^\/apply$/, /^\/consent\/[^/]+$/, /^\/sign-in$/, /^\/forgot-password$/, /^\/reset\/[^/]+$/,
  /^\/invite\/[^/]+$/, /^\/workspace\/(overview|board|bookings|licences|packages|applications|roster|members|rate-cards|offices|me)$/,
  /^\/workspace\/(bookings|applications|talent)\/[^/]+$/, /^\/workspace\/statements(\/[^/]+\/\d{4}-\d{2})?$/,
];

let shell: Buffer | null = null;

async function html(): Promise<Buffer> {
  shell ??= await readFile(new URL("index.html", PUBLIC));
  return shell;
}

/** The status the shell answers with: 410 for a withdrawn or erased profile, 404 for an unknown path. */
async function pageStatus(path: string): Promise<number> {
  const profile = /^\/talent\/([^/]+)$/.exec(path);
  if (profile) {
    const talent = await one<{ state: string }>(pool, "SELECT state FROM talent WHERE slug = $1", [decodeURIComponent(profile[1])]);
    if (!talent) return 404;
    return talent.state === "active" ? 200 : 410;
  }
  return PAGES.some((page) => page.test(path)) ? 200 : 404;
}

export async function serveApp(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, errorReply(new ApiError(405, "method_not_allowed", {}, { Allow: "GET" })));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) {
    const path = normalize(url.pathname).replace(/^\/+/, "");
    if (path.includes("..") || !TYPES[extname(path)]) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(new URL(path, PUBLIC));
      res.writeHead(200, { "Content-Type": TYPES[extname(path)], "Cache-Control": "public, max-age=3600" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  const status = await pageStatus(url.pathname);
  const page = await html();
  res.writeHead(status, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" });
  res.end(page);
}
