import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientConfig } from '../shared/api';
import { config } from './config';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(here, '../client');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

let shell: string | null = null;

function clientConfig(): ClientConfig {
  return {
    mistake_limit: config.mistakeLimit,
    hint_limit: config.hintLimit,
    move_limit: config.moveLimit,
    daily_start: config.dailyStart,
    leaderboard_size: config.leaderboardSize,
  };
}

/** The built page shell, carrying the settings the browser needs. */
async function pageShell(): Promise<string> {
  if (shell !== null) return shell;
  const html = await readFile(path.join(CLIENT_ROOT, 'index.html'), 'utf8');
  const script = `<script id="seam-config" type="application/json">${JSON.stringify(clientConfig())}</script>`;
  shell = html.replace('</head>', `${script}</head>`);
  return shell;
}

export async function sendShell(res: ServerResponse, status: number): Promise<void> {
  const html = await pageShell();
  res.writeHead(status, {
    'content-type': TYPES['.html'] as string,
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  res.end(html);
}

/** Serves one built asset, or reports that the path is not an asset. */
export async function sendAsset(res: ServerResponse, pathname: string): Promise<boolean> {
  const relative = pathname.replace(/^\/+/, '');
  if (relative.length === 0 || relative.includes('..')) return false;
  const extension = path.extname(relative);
  const type = TYPES[extension];
  if (!type || extension === '.html') return false;
  const file = path.join(CLIENT_ROOT, relative);
  if (!file.startsWith(`${CLIENT_ROOT}${path.sep}`)) return false;
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    return false;
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'public, max-age=31536000, immutable',
  });
  res.end(body);
  return true;
}
