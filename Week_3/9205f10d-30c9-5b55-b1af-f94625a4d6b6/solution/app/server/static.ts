/**
 * Serves the built frontend and nothing else: hashed files under /assets and the page shell for
 * the app's own routes. Source, manifests, lockfiles, env and dotfiles are never reachable.
 */
import { readFile } from "node:fs/promises";
import { notFound } from "./errors.js";
import type { Reply } from "./http.js";

const WEB_ROOT = new URL("../web/", import.meta.url);

const APP_ROUTES = [
  /^\/$/,
  /^\/signin$/,
  /^\/board$/,
  /^\/credentials$/,
  /^\/open-seats$/,
  /^\/assignments$/,
  /^\/profile$/,
  /^\/requests$/,
  /^\/requests\/new$/,
  /^\/requests\/[^/]+$/,
  /^\/requests\/[^/]+\/edit$/,
  /^\/jobs\/[^/]+$/,
  /^\/billing$/,
  /^\/invoices$/,
];

const TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  svg: "image/svg+xml",
};

const shell = readFile(new URL("index.html", WEB_ROOT), "utf8");

export async function serveStatic(pathname: string): Promise<Reply> {
  if (APP_ROUTES.some((route) => route.test(pathname))) {
    return { status: 200, text: await shell, contentType: "text/html; charset=utf-8", headers: { "Cache-Control": "no-cache" } };
  }
  const asset = /^\/assets\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(js|css|woff2|svg))$/.exec(pathname);
  if (!asset?.[1] || !asset[2]) throw notFound();
  try {
    return {
      status: 200,
      body: await readFile(new URL(`assets/${asset[1]}`, WEB_ROOT)),
      contentType: TYPES[asset[2]] ?? "application/octet-stream",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    };
  } catch {
    throw notFound();
  }
}
