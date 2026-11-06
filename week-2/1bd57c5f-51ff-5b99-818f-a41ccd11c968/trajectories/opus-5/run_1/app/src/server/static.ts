import { readFile, stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import { sendBytes } from './http.js';

const PUBLIC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function contentTypeOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return TYPES[path.slice(dot)] ?? 'application/octet-stream';
}

let shell: Buffer | null = null;

async function appShell(): Promise<Buffer> {
  if (shell === null) shell = await readFile(join(PUBLIC_ROOT, 'index.html'));
  return shell;
}

/** Serves only files inside the build output. Anything else falls back to the app shell. */
export async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const relative = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.(\/|\\|$))+/, '');
  const target = join(PUBLIC_ROOT, relative);
  if (target.startsWith(PUBLIC_ROOT) && relative !== '/' && relative !== '.') {
    try {
      const info = await stat(target);
      if (info.isFile()) {
        const body = await readFile(target);
        const cache = relative.includes('fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache';
        sendBytes(res, 200, body, contentTypeOf(target), cache);
        return;
      }
    } catch {
      // Falls through to the app shell so client routes work.
    }
  }
  sendBytes(res, 200, await appShell(), TYPES['.html'], 'no-cache');
}
