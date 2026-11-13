import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderApp } from "../client/render.js";
import { parseRoomUrl } from "../shared/derive.js";
import { DIALOG_MS, EASING, HOVER_MS, STEP_MS } from "../shared/motion.js";
import type { Boot } from "../shared/types.js";
import { serializeUser, type Caller } from "./auth.js";
import { now } from "./core.js";
import { readingFor } from "./views.js";

const PAGES: Record<string, string> = {
  "/": "Malhar Key-On",
  "/showroom": "The showroom · Malhar Key-On",
  "/test-ride": "Test ride · Malhar Key-On",
  "/garage": "Garage · Malhar Key-On",
  "/hub": "Hub console · Malhar Key-On",
};

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let assets: { js: string; css: string } | null = null;
const manifest = (): { js: string; css: string } => {
  assets ??= JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8")) as { js: string; css: string };
  return assets;
};

const json = (value: unknown): string => JSON.stringify(value).split("<").join("\\u003c");

export async function renderPage(url: URL, caller: Caller): Promise<{ status: number; html: string }> {
  const known = url.pathname in PAGES;
  const long = url.pathname === "/" || url.pathname === "/showroom";
  let reading: Boot["reading"] = null;
  if (long) {
    const sel = parseRoomUrl(url.search);
    reading = await readingFor(sel.hub, sel.model, sel.finish, caller.user?.role === "rider" ? caller.user.id : null, await now()).catch(() => null);
  }
  const boot: Boot = { user: caller.user ? serializeUser(caller.user) : null, ended: caller.ended, reading };
  const body = renderApp(boot, known ? url.pathname : "/404", url.search);
  const { js, css } = manifest();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${known ? PAGES[url.pathname] : "Not found · Malhar Key-On"}</title>
<meta name="color-scheme" content="dark">
<style>:root{--ease:${EASING};--t-hover:${HOVER_MS}ms;--t-sheet:${DIALOG_MS}ms;--t-dissolve:${STEP_MS.dissolve}ms;--t-lamp:${STEP_MS.lamp}ms;--t-paint:${STEP_MS.paint}ms;--t-settle:${STEP_MS["needle-settle"]}ms}@media (prefers-reduced-motion: reduce){:root{--t-hover:${STEP_MS.dissolve}ms}}</style>
<link rel="preload" href="/fonts/gloock-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/rethink-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/${css}">
<script>document.documentElement.setAttribute("data-mode",matchMedia("(prefers-reduced-motion: reduce)").matches?"reduced":"pending")</script>
</head>
<body>
<div id="app-root">${body}</div>
<script type="application/json" id="boot">${json(boot)}</script>
<script type="module" src="/assets/${js}"></script>
</body>
</html>`;
  return { status: known ? 200 : 404, html };
}
