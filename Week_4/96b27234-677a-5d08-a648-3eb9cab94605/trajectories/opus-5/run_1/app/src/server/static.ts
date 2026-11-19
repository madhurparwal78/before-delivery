import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

const CLIENT_ROUTES = [
  /^\/$/,
  /^\/signin$/,
  /^\/signup$/,
  /^\/confirm\/[^/]+$/,
  /^\/sessions$/,
  /^\/sessions\/[^/]+$/,
  /^\/friends$/,
  /^\/invites\/[^/]+$/,
  /^\/studio$/,
  /^\/communities$/,
  /^\/communities\/[^/]+$/,
  /^\/gatherings\/[^/]+$/,
  /^\/moderation$/
];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function sendFile(res: ServerResponse, filePath: string, status: number): Promise<boolean> {
  try {
    const bytes = await readFile(filePath);
    res.writeHead(status, {
      'content-type': TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      'content-length': bytes.length,
      'cache-control': 'no-store'
    });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

export async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const page = (status: number): Promise<boolean> => sendFile(res, path.join(PUBLIC_DIR, 'index.html'), status);
  const isAppRoute = CLIENT_ROUTES.some((pattern) => pattern.test(pathname));
  if (isAppRoute) {
    await page(200);
    return;
  }
  const segments = pathname.split('/').filter((part) => part !== '');
  const safe = segments.every((part) => part !== '..' && !part.startsWith('.'));
  if (safe && segments.length > 0) {
    const target = path.join(PUBLIC_DIR, ...segments);
    if (target.startsWith(`${PUBLIC_DIR}${path.sep}`) && (await sendFile(res, target, 200))) return;
  }
  await page(404);
}
