import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { drawCoin } from '../fixtures/coin.ts';

/**
 * The built frontend's assets, plus the two staged photographs the grading seed
 * hands out. Generated assets are held in memory, so the app keeps storing its
 * data only in Postgres and MinIO.
 */

const distDir = path.resolve(import.meta.dirname, '..');
const staticDir = path.join(distDir, 'static');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/** The two staged intake photographs, drawn once and reused. */
const generated = new Map<string, { body: Buffer; contentType: string }>();

export function stagedMedia(): { obverse: string; reverse: string } {
  if (!generated.has('media/staged-obverse.png')) {
    generated.set('media/staged-obverse.png', {
      body: drawCoin({ mintmark: 'A', face: 'obverse' }),
      contentType: 'image/png',
    });
    generated.set('media/staged-reverse.png', {
      body: drawCoin({ mintmark: 'A', face: 'reverse' }),
      contentType: 'image/png',
    });
  }
  return { obverse: 'media/staged-obverse.png', reverse: 'media/staged-reverse.png' };
}

const fileCache = new Map<string, { body: Buffer; contentType: string }>();

export async function serveAsset(relative: string, response: ServerResponse): Promise<boolean> {
  // A traversal attempt simply does not resolve to an asset.
  const normalised = path.posix.normalize(relative).replace(/^(\.\.\/)+/, '');
  if (normalised.startsWith('..') || path.isAbsolute(normalised)) return false;

  stagedMedia();
  const inMemory = generated.get(normalised);
  if (inMemory) {
    response.writeHead(200, {
      'content-type': inMemory.contentType,
      'content-length': String(inMemory.body.length),
      'cache-control': 'no-store',
    });
    response.end(inMemory.body);
    return true;
  }

  const cached = fileCache.get(normalised);
  if (cached) {
    sendFile(response, cached);
    return true;
  }

  const target = path.join(staticDir, normalised);
  if (!target.startsWith(staticDir) || !existsSync(target)) return false;
  const body = await readFile(target);
  const entry = {
    body,
    contentType: CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream',
  };
  fileCache.set(normalised, entry);
  sendFile(response, entry);
  return true;
}

function sendFile(
  response: ServerResponse,
  entry: { body: Buffer; contentType: string },
): void {
  response.writeHead(200, {
    'content-type': entry.contentType,
    'content-length': String(entry.body.length),
    'cache-control': 'public, max-age=3600',
  });
  response.end(entry.body);
}

/** The single page the frontend boots from. */
export function pageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flan</title>
<link rel="stylesheet" href="/static/desk.css">
<link rel="icon" href="data:,">
</head>
<body>
<div id="desk-root"></div>
<script type="module" src="/static/app.js"></script>
</body>
</html>`;
}
