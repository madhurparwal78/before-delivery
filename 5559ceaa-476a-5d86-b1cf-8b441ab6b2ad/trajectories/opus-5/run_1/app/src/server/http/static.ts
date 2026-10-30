import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function contentType(path: string): string {
  const dot = path.lastIndexOf('.');
  return TYPES[path.slice(dot)] ?? 'application/octet-stream';
}

async function readPublic(relative: string): Promise<Buffer | null> {
  const target = resolve(PUBLIC_DIR, `.${normalize(`/${relative}`)}`);
  if (!target.startsWith(`${PUBLIC_DIR}/`)) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
}

export async function serveAsset(res: ServerResponse, relative: string): Promise<boolean> {
  const body = await readPublic(relative);
  if (body === null) return false;
  res.writeHead(200, {
    'content-type': contentType(relative),
    'content-length': body.length,
    'cache-control': 'no-cache',
  });
  res.end(body);
  return true;
}

export async function serveDocument(
  res: ServerResponse,
  name: 'index.html' | 'review.html',
  headers: Readonly<Record<string, string>> = {},
): Promise<void> {
  const body = await readPublic(name);
  if (body === null) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Build the app before serving it.');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-cache',
    ...headers,
  });
  res.end(body);
}
