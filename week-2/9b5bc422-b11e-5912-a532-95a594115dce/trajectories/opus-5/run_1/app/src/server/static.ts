import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export type Asset = { bytes: Buffer; type: string; immutable: boolean };

function collect(root: string, directory: string, assets: Map<string, Asset>): void {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      collect(root, full, assets);
      continue;
    }
    const path = `/${relative(root, full).split('\\').join('/')}`;
    const dot = path.lastIndexOf('.');
    const extension = dot === -1 ? '' : path.slice(dot);
    assets.set(path, {
      bytes: readFileSync(full),
      type: TYPES[extension] ?? 'application/octet-stream',
      immutable: path.startsWith('/assets/'),
    });
  }
}

export function loadAssets(root: string): Map<string, Asset> {
  const assets = new Map<string, Asset>();
  collect(root, root, assets);
  return assets;
}

export function sendAsset(response: ServerResponse, asset: Asset): void {
  response.writeHead(200, {
    'Content-Type': asset.type,
    'Content-Length': asset.bytes.length,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  response.end(asset.bytes);
}
