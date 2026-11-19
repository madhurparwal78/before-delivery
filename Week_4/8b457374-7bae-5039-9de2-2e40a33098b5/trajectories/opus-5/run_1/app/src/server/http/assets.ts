import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface Asset {
  readonly contentType: string;
  readonly body: Buffer;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const ROOT = join(import.meta.dirname, 'public');

function collect(directory: string, into: Map<string, Asset>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      collect(full, into);
      continue;
    }
    const extension = entry.name.slice(entry.name.lastIndexOf('.'));
    const contentType = CONTENT_TYPES[extension];
    if (contentType === undefined) continue;
    const path = `/${relative(ROOT, full).split('\\').join('/')}`;
    into.set(path, { contentType, body: readFileSync(full) });
  }
}

/** Only the built browser assets are reachable; nothing else on disk is served. */
const ASSETS: ReadonlyMap<string, Asset> = (() => {
  const map = new Map<string, Asset>();
  collect(ROOT, map);
  return map;
})();

export function readAsset(pathname: string): Asset | null {
  return ASSETS.get(pathname) ?? null;
}

export const SHELL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dotgain</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div id="app"></div>
<script src="/app.js" defer></script>
</body>
</html>
`;
