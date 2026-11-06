import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Reply } from './context.js';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export const CLIENT_ROUTES: readonly string[] = [
  '/',
  '/board',
  '/tickets',
  '/pack',
  '/documents',
  '/counter',
  '/manage',
];

function contentTypeOf(path: string): string | null {
  const extension = Object.keys(CONTENT_TYPES).find((suffix) => path.endsWith(suffix));
  return extension === undefined ? null : (CONTENT_TYPES[extension] as string);
}

/** Only built browser assets are reachable; nothing else on disk is served. */
export async function serveAsset(pathname: string): Promise<Reply | null> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  if (relative === '' || relative.includes('..')) return null;
  const contentType = contentTypeOf(relative);
  if (contentType === null) return null;
  try {
    const bytes = await readFile(join(WEB_ROOT, relative));
    return { status: 200, bytes, contentType };
  } catch {
    return null;
  }
}

export async function serveClientPage(): Promise<Reply> {
  const bytes = await readFile(join(WEB_ROOT, 'index.html'));
  return { status: 200, bytes, contentType: 'text/html; charset=utf-8' };
}
