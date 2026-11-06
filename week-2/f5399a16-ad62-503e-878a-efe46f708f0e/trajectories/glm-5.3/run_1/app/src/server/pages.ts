// The client pages served by the app: one HTML shell for every route, the
// stylesheet, the script and the fonts, all from this origin.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Response } from "./http";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "client");

function readClient(name: string): Buffer | null {
  try {
    return readFileSync(join(root, name));
  } catch {
    return null;
  }
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clapstick</title>
<link rel="stylesheet" href="/clapstick.css">
<link rel="icon" href="data:,">
</head>
<body>
<div id="root"></div>
<script type="module" src="/clapstick.js"></script>
</body>
</html>`;

export function CLIENT_INDEX(path: string): Response {
  if (path === "/clapstick.css") {
    const css = readClient("clapstick.css");
    if (css !== null) {
      return { status: 200, headers: { "content-type": "text/css; charset=utf-8" }, body: css };
    }
  }
  if (path === "/clapstick.js") {
    const js = readClient("index.js");
    if (js !== null) {
      return { status: 200, headers: { "content-type": "text/javascript; charset=utf-8" }, body: js };
    }
  }
  if (path.startsWith("/fonts/")) {
    const font = readClient(path.slice(1));
    if (font !== null) {
      return { status: 200, headers: { "content-type": "font/woff2" }, body: font };
    }
  }
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: HTML };
}
