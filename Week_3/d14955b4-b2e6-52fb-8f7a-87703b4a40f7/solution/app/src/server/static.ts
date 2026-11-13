import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { contentSecurityPolicy } from './http.js';

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../client');

const PAGES = [/^\/$/, /^\/signin$/, /^\/inbox$/, /^\/inbox\/[^/]+$/, /^\/team$/, /^\/widget\/[^/]+$/];
const FILES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

let template: Promise<string> | null = null;

async function frameAncestors(path: string): Promise<string> {
  const slug = /^\/widget\/([^/]+)$/.exec(path)?.[1];
  if (!slug) return "'none'";
  const { rows } = await pool.query<{ launcher_origin: string }>('select launcher_origin from games where slug = $1', [slug]);
  return rows[0]?.launcher_origin ?? "'none'";
}

export async function servePage(req: IncomingMessage, res: ServerResponse, path: string, nonce: string): Promise<void> {
  template ??= readFile(join(CLIENT_DIR, 'index.html'), 'utf8');
  const html = (await template).replace(/<script /g, `<script nonce="${nonce}" `);
  const known = PAGES.some((page) => page.test(path));
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce, await frameAncestors(path)));
  res.writeHead(known ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : html);
}

export async function serveAsset(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const wanted = /^\/(assets|fonts)\/[^/]+$/.test(path) || path === '/icon.svg';
  const extension = /\.[a-z0-9]+$/.exec(path)?.[0] ?? '';
  if (!wanted || !FILES[extension] || normalize(path) !== path) return false;
  try {
    const bytes = await readFile(join(CLIENT_DIR, path));
    res.writeHead(200, { 'Content-Type': FILES[extension], 'Content-Length': bytes.length, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
    return true;
  } catch {
    return false;
  }
}
