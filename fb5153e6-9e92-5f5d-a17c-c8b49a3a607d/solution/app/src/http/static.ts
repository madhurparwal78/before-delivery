import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, } from './app.js';
import { bytes } from './router.js';
import { notFound } from './errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = resolve(here, '..', '..', 'public');

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function contentTypeFor(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return null;
  return CONTENT_TYPES[path.slice(dot)] ?? null;
}

const cache = new Map<string, Buffer>();

/** Serves only the built public assets; every other path is not found. */
async function serveAsset(relative: string): Promise<Buffer> {
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, '');
  const full = join(PUBLIC_ROOT, safe);
  if (!full.startsWith(PUBLIC_ROOT + '/')) throw notFound();
  const cached = cache.get(full);
  if (cached !== undefined) return cached;
  try {
    const body = await readFile(full);
    cache.set(full, body);
    return body;
  } catch {
    throw notFound();
  }
}

export function registerStaticRoutes(): void {
  for (const pattern of [
    '/assets/:a',
    '/assets/:a/:b',
    '/assets/:a/:b/:c',
  ]) {
    route({
      method: 'GET',
      pattern,
      surface: 'media',
      body: 'none',
      handler: async (ctx) => {
        const relative = [ctx.params.a, ctx.params.b, ctx.params.c]
          .filter((part): part is string => part !== undefined)
          .join('/');
        const type = contentTypeFor(relative);
        if (type === null) throw notFound();
        const body = await serveAsset(relative);
        return bytes(200, type, body, {
          headers: { 'Cache-Control': 'public, max-age=3600' },
        });
      },
    });
  }
}
