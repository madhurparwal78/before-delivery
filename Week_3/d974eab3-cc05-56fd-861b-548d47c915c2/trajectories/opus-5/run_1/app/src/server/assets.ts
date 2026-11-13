import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Asset {
  body: Buffer;
  contentType: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
};

function contentTypeOf(name: string): string | undefined {
  return CONTENT_TYPES[name.slice(name.lastIndexOf('.'))];
}

/**
 * Loads the built stylesheet, client bundle and font files. Only the files
 * found here are ever served, so no source file can be reached.
 */
export async function loadAssets(): Promise<Map<string, Asset>> {
  const root = fileURLToPath(new URL('../public/assets/', import.meta.url));
  const assets = new Map<string, Asset>();
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const contentType = contentTypeOf(entry.name);
    if (!entry.isFile() || contentType === undefined) {
      continue;
    }
    const full = join(entry.parentPath, entry.name);
    const path = relative(root, full).split(sep).join('/');
    assets.set(`/assets/${path}`, { body: await readFile(full), contentType });
  }
  return assets;
}
