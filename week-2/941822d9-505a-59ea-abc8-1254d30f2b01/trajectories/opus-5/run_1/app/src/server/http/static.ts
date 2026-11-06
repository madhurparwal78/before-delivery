import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

const CONTENT_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.json', 'application/json; charset=utf-8'],
]);

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return CONTENT_TYPES.get(path.slice(dot).toLowerCase()) ?? 'application/octet-stream';
}

function hasFileExtension(path: string): boolean {
  return path.slice(path.lastIndexOf('/') + 1).includes('.');
}

async function resolveFile(urlPath: string): Promise<string | null> {
  const relative = normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, '');
  if (relative === '' || relative.split(/[/\\]/).includes('..')) return null;
  const candidate = join(WEB_ROOT, relative);
  if (!candidate.startsWith(WEB_ROOT + sep)) return null;
  try {
    const info = await stat(candidate);
    return info.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  baseHeaders: Record<string, string>,
  payload: unknown,
): void {
  response.writeHead(status, {
    ...baseHeaders,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function sendFile(
  response: ServerResponse,
  method: string,
  file: string,
  headers: Record<string, string>,
): void {
  response.writeHead(200, headers);
  if (method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

/** Serves only the built frontend: anything that looks like a file and is not there is a 404. */
export async function serveStatic(
  method: string,
  urlPath: string,
  response: ServerResponse,
  baseHeaders: Record<string, string>,
): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(response, 405, baseHeaders, { error: 'method_not_allowed' });
    return;
  }

  const file = await resolveFile(urlPath);
  if (file !== null) {
    const immutable = urlPath.startsWith('/assets/') || urlPath.startsWith('/fonts/');
    sendFile(response, method, file, {
      ...baseHeaders,
      'content-type': contentTypeFor(file),
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    return;
  }

  if (urlPath !== '/' && hasFileExtension(urlPath)) {
    sendJson(response, 404, baseHeaders, { error: 'not_found' });
    return;
  }

  const index = await resolveFile('/index.html');
  if (index === null) {
    sendJson(response, 404, baseHeaders, { error: 'not_found' });
    return;
  }
  sendFile(response, method, index, {
    ...baseHeaders,
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
}
