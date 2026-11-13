import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Serves only the built client assets, never source or configuration. */
export async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = pathname.replace(/^\/+/, '');
  if (relative === '') return false;
  const resolved = path.join(publicDir, relative);
  if (!resolved.startsWith(`${publicDir}${path.sep}`)) return false;
  const extension = path.extname(resolved);
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) return false;
  try {
    const info = await stat(resolved);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': info.size,
      'cache-control': 'no-cache',
    });
    createReadStream(resolved).pipe(res);
    return true;
  } catch {
    return false;
  }
}
