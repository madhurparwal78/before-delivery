import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errors } from '../errors.js';
import { bytesReply, type Reply } from '../reply.js';
import { route, setStatusPageRenderer } from '../server.js';
import { registerConsolePages } from './console.js';
import { registerPublicPages } from './public.js';
import { statusPage } from './status.js';

const assetsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/assets');

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

async function serveAsset(relative: string): Promise<Reply> {
  const extension = relative.slice(relative.lastIndexOf('.'));
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined || relative.includes('..')) throw errors.publicNotFound();
  const path = join(assetsRoot, relative);
  if (!path.startsWith(assetsRoot)) throw errors.publicNotFound();
  try {
    const bytes = await readFile(path);
    return bytesReply(200, contentType, bytes, { 'Cache-Control': 'public, max-age=3600' });
  } catch {
    throw errors.publicNotFound();
  }
}

export function registerPages(): void {
  route('GET', '/assets/:file', null, async (ctx) => serveAsset(ctx.params.file as string));
  route('GET', '/assets/fonts/:file', null, async (ctx) =>
    serveAsset(join('fonts', ctx.params.file as string)),
  );
  registerPublicPages();
  registerConsolePages();
  setStatusPageRenderer(statusPage);
}
