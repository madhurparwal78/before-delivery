// The browser app: built assets from dist/public/assets and the app shell for each screen path.
// Nothing outside the built assets is ever served.
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, errorBody, sendJson } from "./http";

const ASSETS = fileURLToPath(new URL("./public/assets/", import.meta.url));

const SCREENS = [
  /^\/$/,
  /^\/intake$/,
  /^\/pieces$/,
  /^\/pieces\/\d{1,6}$/,
  /^\/board$/,
  /^\/counter$/,
  /^\/pickup$/,
  /^\/studio$/,
  /^\/rates$/,
  /^\/track\/[A-Za-z0-9_-]+$/,
];

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#9E4321"/><path d="M12 26 L16 6 L20 26 Z" fill="#F3E6D3"/><rect x="9" y="25" width="14" height="3" fill="#F3E6D3"/></svg>`,
  );

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#F3E6D3">
<title>Shelfmark · Brickfield Lane Clayhouse</title>
<link rel="icon" href="${ICON}">
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<div id="root"></div>
<noscript>Shelfmark needs JavaScript to run the firing desk.</noscript>
</body>
</html>
`;

function notFound(res: ServerResponse): void {
  sendJson(res, 404, errorBody(new HttpError(404, "not_found", "Not found.")));
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): void {
  req.resume();
  if (req.method !== "GET" && req.method !== "HEAD") {
    notFound(res);
    return;
  }
  if (SCREENS.some((screen) => screen.test(url.pathname))) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : SHELL);
    return;
  }
  const match = /^\/assets\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
  const type = match ? TYPES[extname(match[1])] : undefined;
  if (!match || !type) {
    notFound(res);
    return;
  }
  const file = normalize(join(ASSETS, match[1]));
  if (!file.startsWith(ASSETS)) {
    notFound(res);
    return;
  }
  readFile(file).then(
    (data) => {
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": data.length,
        "Cache-Control": /-[A-Z0-9]{8}\./.test(match[1]) ? "public, max-age=31536000, immutable" : "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    },
    () => notFound(res),
  );
}
