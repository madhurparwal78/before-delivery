import type { ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

export interface AssetReader {
  (path: string): Buffer | null;
}

export function makeAssetReader(distRoot: string): AssetReader {
  return (path: string): Buffer | null => {
    const clean = path.replace(/^\/+/, "");
    // Never serve source, package files or env files.
    if (clean.startsWith("src/") || clean === "package.json" || clean.startsWith(".")) return null;
    const full = join(distRoot, clean);
    if (!full.startsWith(distRoot)) return null;
    if (!existsSync(full)) return null;
    try {
      const stat = statOf(full);
      if (stat === null || stat.isFile()) return readFileSync(full);
    } catch {
      return null;
    }
    return null;
  };
}

import { statSync } from "node:fs";
function statOf(full: string): { isFile(): boolean } | null {
  try {
    const s = statSync(full);
    if (s.isFile()) return s;
    return null;
  } catch {
    return null;
  }
}

export function serveAsset(res: ServerResponse, path: string, read: AssetReader): boolean {
  const bytes = read(path);
  if (bytes === null) return false;
  const ext = path.slice(path.lastIndexOf("."));
  const type = ASSET_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "content-length": bytes.length, "cache-control": "no-cache" });
  res.end(bytes);
  return true;
}

/** The app shell: one page, routes rendered by the browser. */
export function appShell(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="app"><noscript>Undersign needs JavaScript.</noscript></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
