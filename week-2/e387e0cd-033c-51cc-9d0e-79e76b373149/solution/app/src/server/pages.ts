// The built screens and their assets, each page route answered with its published HTTP status.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./auth.js";
import { one, pool } from "./db.js";
import { publicPageStatus } from "./routes/public.js";
import { pageStatus, type RequestPageRow } from "./cases/record.js";
import { workspaceBySlug } from "./workspaces.js";
import type { Reply } from "./http.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const STAFF_ROUTES = [
  /^cases$/, /^cases\/[^/]+$/, /^review$/, /^messages$/, /^messages\/[^/]+$/, /^counterparties$/, /^counterparties\/import$/,
  /^counterparties\/[^/]+$/, /^rules$/, /^rules\/[^/]+$/, /^reports\/daily$/, /^months$/, /^months\/\d{4}-\d{2}$/, /^files$/,
  /^partner-keys$/, /^members$/, /^listing$/,
];

let shell: Buffer | null = null;

async function screenStatus(pathname: string): Promise<number> {
  if (pathname === "/" || pathname === "/sign-in") return 200;
  const staffRoute = /^\/w\/([^/]+)\/(.+?)\/?$/.exec(pathname);
  if (staffRoute) return workspaceBySlug(staffRoute[1]) && STAFF_ROUTES.some((r) => r.test(staffRoute[2])) ? 200 : 404;
  const requestPage = /^\/r\/([^/]+)$/.exec(pathname);
  if (requestPage) {
    const page = await one<RequestPageRow>(pool, "SELECT * FROM request_pages WHERE token_hash = $1", [digest(requestPage[1])]);
    return !page ? 404 : pageStatus(page, Date.now()) === "ended" ? 410 : 200;
  }
  return (await publicPageStatus(pathname)) || 404;
}

export async function page(pathname: string): Promise<Reply> {
  const asset = /^\/(assets|fonts)\/([A-Za-z0-9._-]+)$/.exec(pathname);
  if (asset) {
    const type = TYPES[path.extname(asset[2])];
    try {
      if (!type) throw new Error("not a published asset type");
      const body = await readFile(path.join(PUBLIC_DIR, asset[1], asset[2]));
      return { status: 200, body, headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" } };
    } catch {
      return { status: 404, body: "Not found.", headers: { "Content-Type": "text/plain; charset=utf-8" } };
    }
  }
  shell ??= await readFile(path.join(PUBLIC_DIR, "index.html"));
  return {
    status: await screenStatus(pathname),
    body: shell,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  };
}
