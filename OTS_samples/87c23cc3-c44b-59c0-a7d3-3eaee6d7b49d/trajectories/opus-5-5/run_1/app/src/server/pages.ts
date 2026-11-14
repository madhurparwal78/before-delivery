import { readFileSync, readdirSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { PAGE_CONFIG_ID, type PageConfig } from "../shared/page-config.js";
import { SESSION_COOKIE, userForSession, type User } from "./auth.js";
import { config, parseLimits } from "./config.js";
import { transaction } from "./db.js";
import { ApiError } from "./errors.js";
import { activeShare, projectAccess } from "./project-store.js";

const publicDir = new URL("../public/", import.meta.url);

interface Asset {
  body: Buffer;
  type: string;
}

const assets = new Map<string, Asset>();
assets.set("/assets/app.js", { body: readFileSync(new URL("app.js", publicDir)), type: "text/javascript; charset=utf-8" });
assets.set("/assets/app.css", { body: readFileSync(new URL("app.css", publicDir)), type: "text/css; charset=utf-8" });
for (const file of readdirSync(new URL("fonts/", publicDir))) {
  assets.set(`/assets/fonts/${file}`, { body: readFileSync(new URL(`fonts/${file}`, publicDir)), type: "font/woff2" });
}

export function serveAsset(pathname: string, res: ServerResponse): boolean {
  const asset = assets.get(pathname);
  if (!asset) return false;
  res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
  res.end(asset.body);
  return true;
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function html(pageConfig: PageConfig): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Joinery</title>
<link rel="preload" href="/assets/fonts/noto-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/jetbrains-mono-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
<script type="application/json" id="${PAGE_CONFIG_ID}">${escapeJson(pageConfig)}</script>
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<div id="app"></div>
</body>
</html>
`;
}

type PageOutcome = { status: 200 | 404 } | { redirect: string };

async function pageOutcome(pathname: string, user: User | null): Promise<PageOutcome> {
  if (pathname === "/" || pathname === "/signin") return { status: 200 };
  if (pathname === "/projects") return user ? { status: 200 } : { redirect: "/signin" };
  const project = /^\/projects\/([^/]+)$/.exec(pathname);
  if (project) {
    try {
      if (!user) return { status: 404 };
      await transaction((db) => projectAccess(db, decodeURIComponent(project[1]!), user));
      return { status: 200 };
    } catch (error) {
      if (error instanceof ApiError || error instanceof URIError) return { status: 404 };
      throw error;
    }
  }
  const shared = /^\/s\/([^/]+)$/.exec(pathname);
  if (shared) {
    const share = await transaction((db) => activeShare(db, decodeURIComponent(shared[1]!))).catch(() => null);
    return { status: share ? 200 : 404 };
  }
  return { status: 404 };
}

export async function servePage(pathname: string, cookies: Record<string, string>, res: ServerResponse): Promise<void> {
  const user = await userForSession(cookies[SESSION_COOKIE]).catch(() => null);
  const outcome = await pageOutcome(pathname, user);
  if ("redirect" in outcome) {
    res.writeHead(302, { Location: outcome.redirect, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const pageConfig: PageConfig = {
    parseDelayMs: config.parseDelayMs,
    limits: parseLimits,
    timeZone: config.timeZone,
    notFound: outcome.status === 404,
    signedIn: user !== null,
  };
  res.writeHead(outcome.status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html(pageConfig));
}
