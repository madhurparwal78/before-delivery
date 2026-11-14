import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRoute, titleOf } from "../shared/routes";
import type { Boot, Catalog } from "../shared/types";

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
const FONT_TYPES: Record<string, string> = { ".woff2": "font/woff2" };

export interface Asset {
  path: string;
  type: string;
  cache: string;
}

/** The built browser assets the pages reference: the script, the stylesheet and the font files, and nothing else. */
export function listAssets(): Map<string, Asset> {
  const assets = new Map<string, Asset>();
  assets.set("/assets/app.js", { path: join(CLIENT_ROOT, "app.js"), type: "text/javascript; charset=utf-8", cache: "no-cache" });
  assets.set("/assets/app.css", { path: join(CLIENT_ROOT, "app.css"), type: "text/css; charset=utf-8", cache: "no-cache" });
  for (const file of readdirSync(join(CLIENT_ROOT, "fonts"))) {
    const type = FONT_TYPES[file.slice(file.lastIndexOf("."))];
    if (type) assets.set(`/fonts/${file}`, { path: join(CLIENT_ROOT, "fonts", file), type, cache: "public, max-age=31536000, immutable" });
  }
  return assets;
}

const PRELOADED_FONTS = ["bodoni-moda-latin-wght-normal.woff2", "figtree-latin-wght-normal.woff2"];
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230A0F1A'/%3E%3Ccircle cx='16' cy='16' r='9' fill='none' stroke='%23C9A24B' stroke-width='2.5'/%3E%3Ccircle cx='16' cy='7' r='3' fill='%23C9A24B'/%3E%3C/svg%3E";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface Page {
  status: number;
  html: string;
}

/** Every address answers with the same shell: its own title, and the catalog the browser draws the page from. */
export function renderPage(pathname: string, boot: Boot): Page {
  const catalog: Catalog = boot.catalog;
  const route = resolveRoute(pathname, catalog);
  const json = JSON.stringify(boot).replace(/</g, "\\u003c");
  const preloads = PRELOADED_FONTS.map((file) => `<link rel="preload" href="/fonts/${file}" as="font" type="font/woff2" crossorigin>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(titleOf(route))}</title><meta name="color-scheme" content="dark"><link rel="icon" href="${FAVICON}">${preloads}<link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div><script type="application/json" id="boot">${json}</script><script type="module" src="/assets/app.js"></script></body></html>`;
  return { status: route.name === "not-found" ? 404 : 200, html };
}
