import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TIME_ZONES } from "./time.js";

// The browser shell and its three assets. Only these files are ever served from disk; every other
// path is either a known page (200) or the not-found page (404). Source, manifests and config never are.

const root = new URL("../../../", import.meta.url);

const ASSETS: Record<string, { file: string; type: string }> = {
  "/assets/app.js": { file: "dist/public/app.js", type: "text/javascript; charset=utf-8" },
  "/assets/app.css": { file: "dist/public/app.css", type: "text/css; charset=utf-8" },
  "/assets/jost.woff2": { file: "public/fonts/jost-latin-wght-normal.woff2", type: "font/woff2" },
};

const loaded = new Map(Object.entries(ASSETS).map(([path, a]) => [path, { type: a.type, data: readFileSync(new URL(a.file, root)) }]));

const PAGES = [
  /^\/$/,
  /^\/campaigns\/[A-Za-z0-9_-]{1,128}$/,
  /^\/studio$/,
  /^\/studio\/campaigns\/[A-Za-z0-9_-]{1,128}$/,
  /^\/pledges$/,
  /^\/fix\/[A-Za-z0-9_-]{1,128}$/,
];

const SHELL = Buffer.from(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Dotgain by Coldset Works</title>
<link rel="preload" href="/assets/jost.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="time-zones">${JSON.stringify(TIME_ZONES)}</script>
</body>
</html>
`);

export function serveWeb(req: IncomingMessage, res: ServerResponse, path: string): void {
  req.resume();
  const asset = loaded.get(path);
  if (asset) {
    res.writeHead(200, { "Content-Type": asset.type, "Content-Length": asset.data.length, "Cache-Control": "no-cache" }).end(asset.data);
    return;
  }
  const known = (req.method === "GET" || req.method === "HEAD") && PAGES.some((p) => p.test(path));
  res.writeHead(known ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }).end(SHELL);
}
