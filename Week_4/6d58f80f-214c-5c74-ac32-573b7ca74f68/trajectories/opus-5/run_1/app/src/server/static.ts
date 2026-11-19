import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, posix, relative } from 'node:path';
import type { ServerResponse } from 'node:http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export const APP_SCREENS = new Set([
  '/',
  '/sign-in',
  '/drive',
  '/recent',
  '/shared',
  '/bin',
  '/handovers',
  '/settings',
]);

export class StaticAssets {
  private readonly root: string;
  private readonly files = new Map<string, string>();
  private shell = '<!doctype html><title>Lintel Drive</title>';

  constructor(root: string) {
    this.root = root;
  }

  /** Only the built browser assets are ever served; the list is taken once at boot. */
  async load(): Promise<void> {
    const walk = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        const url = `/${relative(this.root, full).split(/[\\/]/).join(posix.sep)}`;
        if (url === '/index.html') continue;
        if (CONTENT_TYPES[extname(url)] === undefined) continue;
        this.files.set(url, full);
      }
    };
    await stat(this.root);
    await walk(this.root);
    this.shell = await readFile(join(this.root, 'index.html'), 'utf8');
  }

  serve(url: string, res: ServerResponse): boolean {
    const path = this.files.get(url);
    if (path === undefined) return false;
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(url)] ?? 'application/octet-stream',
      'cache-control': url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(path).pipe(res);
    return true;
  }

  serveShell(res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(this.shell);
  }
}
