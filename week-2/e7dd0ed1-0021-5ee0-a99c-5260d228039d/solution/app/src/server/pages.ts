// Pages and built assets from this one origin (brief: Screens and layout, Page access and redirects;
// Server boundary). Only files the build produced are ever served.
import { readdirSync, readFileSync } from "node:fs";
import { caller, membership } from "./access.js";
import { pool, query } from "./db.js";
import { ApiError } from "./errors.js";
import { send, type Ctx } from "./http.js";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

function collect(directory: URL, prefix: string): Map<string, { body: Buffer; type: string }> {
  const files = new Map<string, { body: Buffer; type: string }>();
  let names: string[] = [];
  try {
    names = readdirSync(directory);
  } catch {
    return files;
  }
  for (const name of names) {
    const type = TYPES[name.slice(name.lastIndexOf("."))];
    if (type) files.set(`${prefix}${name}`, { body: readFileSync(new URL(name, directory)), type });
  }
  return files;
}

const ASSETS = new Map([
  ...collect(new URL("./public/assets/", import.meta.url), "/assets/"),
  ...collect(new URL("../public/fonts/", import.meta.url), "/fonts/"),
]);

export function serveAsset(ctx: Ctx): boolean {
  const asset = ASSETS.get(ctx.path);
  if (!asset || (ctx.method !== "GET" && ctx.method !== "HEAD")) return false;
  send(ctx, 200, { "Content-Type": asset.type, "Cache-Control": "public, max-age=3600" }, asset.body);
  return true;
}

// The page shell. For console pages it carries the slugs of the caller's suspended workspaces, so the
// suspension banner shows on every console page of such a workspace from the first frame.
const shellHtml = (suspended: string[]): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0E1116">
<title>Farshore Buckets</title>
<link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/space-grotesk-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body data-suspended="${suspended.join(" ")}"><div id="app"></div></body>
</html>
`;

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

const shell = (ctx: Ctx, status: number, suspended: string[] = []): void => send(ctx, status, PAGE_HEADERS, shellHtml(suspended));
const redirect = (ctx: Ctx, location: string): void => send(ctx, 302, { Location: location, "Cache-Control": "no-store" });

const isPage = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

// Answers page routes; false when the path is not a page. Console, account and operator pages need a
// fully signed-in session: anyone else goes to /signin, keeping the requested address.
export async function servePage(ctx: Ctx): Promise<boolean> {
  if (ctx.method !== "GET" && ctx.method !== "HEAD") return false;
  const path = ctx.path;
  if (path === "/" || path === "/signin" || /^\/invite\/[A-Za-z0-9_-]+$/.test(path)) {
    shell(ctx, 200);
    return true;
  }
  const consolePage = isPage(path, "/console");
  const opsPage = isPage(path, "/ops");
  if (!consolePage && !opsPage && path !== "/account") return false;
  const who = await caller(ctx);
  const target = ctx.rawPath + (ctx.rawQuery ? `?${ctx.rawQuery}` : "");
  if (who.kind !== "active") {
    redirect(ctx, `/signin?next=${encodeURIComponent(target)}`);
    return true;
  }
  const { user } = who;
  if (consolePage && user.operator) {
    redirect(ctx, "/ops");
    return true;
  }
  if (opsPage && !user.operator) {
    redirect(ctx, "/console");
    return true;
  }
  if (!consolePage) {
    shell(ctx, 200);
    return true;
  }
  const slug = path.split("/")[2];
  const suspended = (await query<{ slug: string }>(pool,
    `SELECT w.slug FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 AND w.status = 'suspended'`,
    [user.id])).map((w) => w.slug);
  if (slug) {
    try {
      await membership(ctx, slug);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "not_found") throw error;
      shell(ctx, 404, suspended);
      return true;
    }
  }
  shell(ctx, 200, suspended);
  return true;
}
