import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CLIENT_ROUTES } from '../../shared/contract.js';
import type { Reply } from './router.js';

const CLIENT_ROOT = path.resolve(import.meta.dirname, '../../client');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function readIfFile(absolute: string): Promise<Buffer | null> {
  try {
    const stats = await stat(absolute);
    return stats.isFile() ? await readFile(absolute) : null;
  } catch {
    return null;
  }
}

/**
 * Serves the built client, its fonts and the app shell. Anything else — source, manifests,
 * lockfiles, environment files — is simply not there.
 */
export async function serveClient(pathname: string): Promise<Reply | null> {
  const shell = async (): Promise<Reply | null> => {
    const html = await readIfFile(path.join(CLIENT_ROOT, 'index.html'));
    return html === null
      ? null
      : {
          status: 200,
          raw: html,
          headers: { 'content-type': MIME_TYPES['.html'] ?? '', 'cache-control': 'no-store' },
        };
  };

  if (CLIENT_ROUTES.includes(pathname)) {
    return shell();
  }

  const resolved = path.resolve(CLIENT_ROOT, `.${pathname}`);
  if (resolved.startsWith(`${CLIENT_ROOT}${path.sep}`)) {
    const extension = path.extname(resolved);
    const mime = MIME_TYPES[extension];
    if (mime !== undefined) {
      const bytes = await readIfFile(resolved);
      if (bytes !== null) {
        const immutable = pathname.startsWith('/assets/') || pathname.startsWith('/fonts/');
        return {
          status: 200,
          raw: bytes,
          headers: {
            'content-type': mime,
            'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
          },
        };
      }
    }
  }

  return null;
}
