/** The page shell and the built static assets. The server serves nothing else. */
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { ServerResponse } from 'node:http';

const publicRoot = join(import.meta.dirname, '../public');

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

export const PAGE_PATHS = ['/', '/sign-in', '/library', '/profile'] as const;

export function isPagePath(path: string): boolean {
  if ((PAGE_PATHS as readonly string[]).includes(path)) return true;
  return /^\/projects\/[^/]+$/.test(path) || /^\/review\/[^/]+$/.test(path);
}

export function shell(title: string, status = 200): { body: string; status: number } {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
  return { body, status };
}

export function sendHtml(response: ServerResponse, html: { body: string; status: number }): void {
  response.writeHead(html.status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html.body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(html.body);
}

const ALLOWED = new Set(['.js', '.css', '.woff2', '.svg']);

export async function sendAsset(response: ServerResponse, path: string): Promise<boolean> {
  const extension = extname(path);
  if (!ALLOWED.has(extension)) return false;
  const resolved = normalize(join(publicRoot, path));
  if (!resolved.startsWith(publicRoot)) return false;
  let bytes: Buffer;
  try {
    bytes = await readFile(resolved);
  } catch {
    return false;
  }
  response.writeHead(200, {
    'content-type': TYPES[extension] ?? 'application/octet-stream',
    'content-length': bytes.length,
    'cache-control': extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  response.end(bytes);
  return true;
}
