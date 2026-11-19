import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ASSET_ROOT = resolve(here, 'assets');
const PUBLIC_ROOT = resolve(here, 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

export interface Asset {
  payload: Buffer;
  contentType: string;
  immutable: boolean;
}

/** Only built frontend assets are served; anything outside the build output is unknown. */
export async function readAsset(pathname: string): Promise<Asset | null> {
  if (!pathname.startsWith('/assets/')) return null;
  const relative = normalize(pathname.slice('/assets/'.length));
  if (relative.startsWith('..') || relative.includes('\0')) return null;

  const candidates = relative.startsWith('fonts/')
    ? [join(PUBLIC_ROOT, relative)]
    : [join(ASSET_ROOT, relative)];
  for (const candidate of candidates) {
    const root = candidate.startsWith(ASSET_ROOT) ? ASSET_ROOT : PUBLIC_ROOT;
    if (!candidate.startsWith(root)) continue;
    const found = await stat(candidate).catch(() => null);
    if (found === null || !found.isFile()) continue;
    const extension = extname(candidate);
    return {
      payload: await readFile(candidate),
      contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
      immutable: extension === '.woff2',
    };
  }
  return null;
}
