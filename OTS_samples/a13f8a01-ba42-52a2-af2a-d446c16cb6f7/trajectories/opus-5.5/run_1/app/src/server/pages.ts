import { readFileSync } from "node:fs";
import { canView } from "./access";
import { sha256Hex, type UserRow } from "./auth";
import { one, pool } from "./db";
import type { Visibility } from "../shared/types";
import type { Reply } from "./http";

interface Asset {
  body: Buffer;
  type: string;
}

const assets = new Map<string, Asset>();

function addAsset(name: string, url: URL, type: string): void {
  assets.set(name, { body: readFileSync(url), type });
}

addAsset("app.js", new URL("./public/app.js", import.meta.url), "text/javascript; charset=utf-8");
addAsset("app.css", new URL("../static/app.css", import.meta.url), "text/css; charset=utf-8");
for (const font of [
  "work-sans-latin-300-normal.woff2",
  "work-sans-latin-400-normal.woff2",
  "work-sans-latin-500-normal.woff2",
  "work-sans-latin-600-normal.woff2",
  "fragment-mono-latin-400-normal.woff2",
]) {
  addAsset(`fonts/${font}`, new URL(`../static/fonts/${font}`, import.meta.url), "font/woff2");
}

function assetVersion(name: string): string {
  return sha256Hex(assets.get(name)?.body ?? "").slice(0, 12);
}

function shell(content: string, notFound: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${notFound ? "Nothing here · Ashlar" : "Ashlar"}</title>
<link rel="preload" href="/assets/fonts/work-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css?v=${assetVersion("app.css")}">
<script type="module" src="/assets/app.js?v=${assetVersion("app.js")}"></script>
</head>
<body>
<div id="app"${notFound ? " data-not-found" : ""}>${content}</div>
</body>
</html>
`;
}

const appShell = shell("", false);
const notFoundShell = shell(
  `<main class="not-found"><h1>Nothing here</h1><p>This pen does not exist, or it is not shared with you.</p><p><a href="/explore">Go to Explore</a></p></main>`,
  true,
);

const pageSecurity = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

export function framingHeaders(pathname: string): Record<string, string> {
  if (pathname.startsWith("/embed/") || pathname.startsWith("/preview/") || pathname.startsWith("/shelf/")) return {};
  return { "X-Frame-Options": "SAMEORIGIN" };
}

function page(status: number, html: string, pathname: string): Reply {
  const framed = pathname.startsWith("/embed/");
  return {
    kind: "raw",
    status,
    body: html,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...pageSecurity,
      "Content-Security-Policy": `${pageSecurity["Content-Security-Policy"]}; frame-ancestors ${framed ? "*" : "'self'"}`,
    },
  };
}

export function serveAsset(name: string): Reply | null {
  const asset = assets.get(name);
  if (!asset) return null;
  return { kind: "raw", status: 200, body: asset.body, headers: { "Content-Type": asset.type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } };
}

async function penVisible(penId: string, viewer: UserRow | null, embed: boolean): Promise<boolean> {
  const pen = await one<{ owner_id: string; visibility: Visibility }>(pool, "SELECT owner_id, visibility FROM pens WHERE id = $1", [penId]);
  if (!pen) return false;
  return embed ? pen.visibility !== "private" : canView(pen, viewer?.id ?? null);
}

const staticPages = new Set(["/", "/signup", "/signin", "/verify", "/dashboard", "/explore", "/collections", "/shelf"]);

export async function servePage(pathname: string, viewer: UserRow | null): Promise<Reply> {
  if (staticPages.has(pathname)) return page(200, appShell, pathname);
  const pen = /^\/pen\/([a-z0-9]{10})(\/history)?$/.exec(pathname);
  if (pen && (await penVisible(pen[1] as string, viewer, false))) return page(200, appShell, pathname);
  const embed = /^\/embed\/([a-z0-9]{10})$/.exec(pathname);
  if (embed && (await penVisible(embed[1] as string, viewer, true))) return page(200, appShell, pathname);
  const collection = /^\/collections\/([a-z0-9]{10})$/.exec(pathname);
  if (collection && viewer && (await one(pool, "SELECT 1 FROM collections WHERE id = $1 AND owner_id = $2", [collection[1], viewer.id]))) {
    return page(200, appShell, pathname);
  }
  return page(404, notFoundShell, pathname);
}
