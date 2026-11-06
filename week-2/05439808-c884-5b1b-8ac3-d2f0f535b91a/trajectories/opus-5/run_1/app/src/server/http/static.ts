import { readdir, readFile } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

type Asset = { body: Buffer; contentType: string };

const assets = new Map<string, Asset>();
let indexDocument: Asset | null = null;

const clientRoot = fileURLToPath(new URL('../../client/', import.meta.url));

async function collect(directory: string, prefix: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(directory, entry.name);
    const urlPath = posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      await collect(full, urlPath);
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) continue;
    const asset: Asset = { body: await readFile(full), contentType };
    assets.set(urlPath, asset);
    if (urlPath === '/index.html') indexDocument = asset;
  }
}

export async function loadClientAssets(): Promise<void> {
  try {
    await collect(clientRoot, '/');
  } catch {
    assets.clear();
    indexDocument = null;
  }
}

export function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  };
}

export function serveStatic(path: string, response: ServerResponse): void {
  const asset = assets.get(path);
  if (asset) {
    response.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': asset.contentType,
      'Content-Length': asset.body.length,
      'Cache-Control': path === '/index.html' ? 'no-store' : 'public, max-age=3600'
    });
    response.end(asset.body);
    return;
  }
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  if (!lastSegment.includes('.') && indexDocument) {
    response.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': indexDocument.contentType,
      'Content-Length': indexDocument.body.length,
      'Cache-Control': 'no-store'
    });
    response.end(indexDocument.body);
    return;
  }
  const body = Buffer.from(
    JSON.stringify({ error: 'not_found', message: "We couldn't find that." }),
    'utf8'
  );
  response.writeHead(404, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length
  });
  response.end(body);
}
