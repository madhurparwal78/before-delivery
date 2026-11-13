import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = fileURLToPath(new URL('../../../client/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

function send(response: ServerResponse, path: string, size: number, immutable: boolean): void {
  const extension = extname(path);
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'content-length': size,
    'x-content-type-options': 'nosniff',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(path).pipe(response);
}

function notFound(response: ServerResponse): void {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  response.end('Not found');
}

/**
 * Serves the built client assets, and the app shell for the client's own routes. Anything
 * that looks like a file request and is not a built asset is a 404, so source files,
 * manifests and lockfiles are never served.
 */
export async function serveClient(path: string, response: ServerResponse, headOnly: boolean): Promise<void> {
  const normalised = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(CLIENT_ROOT, normalised);
  if (!candidate.startsWith(CLIENT_ROOT.endsWith(sep) ? CLIENT_ROOT : `${CLIENT_ROOT}${sep}`)) {
    notFound(response);
    return;
  }

  const size = await fileSize(candidate);
  if (size !== null && path !== '/') {
    if (headOnly) {
      response.writeHead(200, { 'content-length': size });
      response.end();
      return;
    }
    send(response, candidate, size, normalised.startsWith(`assets${sep}`));
    return;
  }

  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  if (lastSegment.includes('.')) {
    notFound(response);
    return;
  }

  const shell = join(CLIENT_ROOT, 'index.html');
  const shellSize = await fileSize(shell);
  if (shellSize === null) {
    notFound(response);
    return;
  }
  if (headOnly) {
    response.writeHead(200, { 'content-type': CONTENT_TYPES['.html'] ?? 'text/html', 'content-length': shellSize });
    response.end();
    return;
  }
  send(response, shell, shellSize, false);
}
