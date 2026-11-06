/** The built browser assets, and nothing else, are served from disk. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiResponse } from './http';

interface Asset {
  bytes: Buffer;
  contentType: string;
  immutable: boolean;
}

const PUBLIC_DIRECTORY = path.join(__dirname, 'public');

const ASSET_FILES: readonly { route: string; file: string; contentType: string; immutable: boolean }[] = [
  { route: '/app.js', file: 'app.js', contentType: 'text/javascript; charset=utf-8', immutable: false },
  { route: '/styles.css', file: 'styles.css', contentType: 'text/css; charset=utf-8', immutable: false },
  { route: '/fonts/archivo-500.woff2', file: 'fonts/archivo-500.woff2', contentType: 'font/woff2', immutable: true },
  { route: '/fonts/archivo-600.woff2', file: 'fonts/archivo-600.woff2', contentType: 'font/woff2', immutable: true },
  { route: '/fonts/plex-sans-400.woff2', file: 'fonts/plex-sans-400.woff2', contentType: 'font/woff2', immutable: true },
  { route: '/fonts/plex-sans-600.woff2', file: 'fonts/plex-sans-600.woff2', contentType: 'font/woff2', immutable: true },
  { route: '/fonts/plex-mono-400.woff2', file: 'fonts/plex-mono-400.woff2', contentType: 'font/woff2', immutable: true },
  { route: '/fonts/plex-mono-500.woff2', file: 'fonts/plex-mono-500.woff2', contentType: 'font/woff2', immutable: true },
];

const assets = new Map<string, Asset>();
let appShell: Buffer | null = null;

export function loadStaticAssets(): void {
  for (const entry of ASSET_FILES) {
    assets.set(entry.route, {
      bytes: readFileSync(path.join(PUBLIC_DIRECTORY, entry.file)),
      contentType: entry.contentType,
      immutable: entry.immutable,
    });
  }
  appShell = readFileSync(path.join(PUBLIC_DIRECTORY, 'index.html'));
}

const APP_ROUTES: readonly RegExp[] = [
  /^\/$/,
  /^\/cite\/[^/]+\/[^/]+$/,
  /^\/staff$/,
  /^\/staff\/restatements$/,
  /^\/staff\/restatements\/[^/]+$/,
  /^\/operator$/,
];

export function staticResponse(pathname: string): ApiResponse | null {
  const asset = assets.get(pathname);
  if (asset !== undefined) {
    return {
      status: 200,
      headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
      bytes: asset.bytes,
    };
  }
  if (appShell !== null && APP_ROUTES.some((pattern) => pattern.test(pathname))) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
      bytes: appShell,
    };
  }
  return null;
}
