// Serves the built client from dist/public only, plus the HTML shell; anything else is not a file.
import { readdirSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./public", import.meta.url));
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" };

const shell = (preloads: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Spoorline</title>
<link rel="icon" href="data:,">
${preloads}<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;

function listFiles(dir: string, prefix = ""): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) for (const [url, file] of listFiles(path, `${prefix}${name}/`)) files.set(url, file);
    else files.set(`/${prefix}${name}`, path);
  }
  return files;
}

const assets = listFiles(ROOT);

// Every face loads beside the stylesheet (the 500s too: labels, tabs and the sign-in statement), so the first paint already uses them and the text does not reflow when they arrive.
const PRELOADED_FONTS = /^\/assets\/(inter-latin-(400|500|600)|jetbrains-mono-latin-(400|500))-/;
const SHELL = shell(
  [...assets.keys()].filter((url) => PRELOADED_FONTS.test(url)).sort()
    .map((url) => `<link rel="preload" href="${url}" as="font" type="font/woff2" crossorigin>\n`).join(""),
);

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
};

/** Answers a page request; returns false for a path that looks like a file but is not one of the built assets. */
export function servePage(path: string, res: ServerResponse): boolean {
  const file = assets.get(path);
  if (file) {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(readFileSync(file));
    return true;
  }
  if (extname(path) !== "") return false;
  res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  res.end(SHELL);
  return true;
}
