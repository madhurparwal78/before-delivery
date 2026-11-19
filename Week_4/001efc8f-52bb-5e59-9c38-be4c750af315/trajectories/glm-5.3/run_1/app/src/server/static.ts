import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const ASSET_DIR = join(__dirname, '..', '..', 'public');

/** Serves only the built browser assets; never source, config or credentials. */
export function serveStatic(name: string): { body: Buffer; contentType: string } | null {
  const safe = name.replace(/\.\./g, '');
  const full = join(ASSET_DIR, safe);
  if (!full.startsWith(ASSET_DIR) || !existsSync(full) || !statSync(full).isFile()) return null;
  const contentType = MIME[extname(full)] ?? 'application/octet-stream';
  return { body: readFileSync(full), contentType };
}
