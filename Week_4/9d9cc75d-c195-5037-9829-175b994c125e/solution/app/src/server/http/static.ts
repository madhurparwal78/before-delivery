import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Reply } from './reply.ts';
import { bytes } from './reply.ts';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const LONG_CACHE = 'public, max-age=31536000, immutable';

/** Serves the built browser bundle and the bundled fonts, and nothing else. */
export class StaticFiles {
  private indexHtml: Promise<Buffer> | null = null;

  constructor(private readonly root: string) {}

  /** `/assets/*` and `/fonts/*` files by exact name; every other path is the app shell (the SPA fallback). */
  async serve(pathname: string): Promise<Reply | null> {
    const folder = pathname.startsWith('/assets/') ? 'assets' : pathname.startsWith('/fonts/') ? 'fonts' : null;
    if (folder === null) return this.shell();
    const type = TYPES[path.extname(pathname).toLowerCase()];
    const file = path.join(this.root, pathname);
    if (!type || !file.startsWith(path.join(this.root, folder) + path.sep)) return null;
    try {
      return bytes(200, await readFile(file), type, { 'Cache-Control': LONG_CACHE });
    } catch {
      return null;
    }
  }

  private async shell(): Promise<Reply | null> {
    this.indexHtml ??= readFile(path.join(this.root, 'index.html'));
    try {
      return bytes(200, await this.indexHtml, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' });
    } catch {
      this.indexHtml = null;
      return null;
    }
  }
}
