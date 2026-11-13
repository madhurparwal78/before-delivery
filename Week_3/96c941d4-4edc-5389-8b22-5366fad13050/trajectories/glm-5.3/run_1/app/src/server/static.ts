import { ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.json': 'application/json',
};

export async function serveStatic(root: string, res: ServerResponse, urlPath: string): Promise<boolean> {
  let relative = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  if (relative.includes('..')) return false;
  const filePath = join(root, relative);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
    return true;
  } catch {
    // SPA fallback for client routes.
    if (!urlPath.startsWith('/api')) {
      try {
        const data = await readFile(join(root, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
        res.end(data);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}
