import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../public');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SERVED = new Set(['/app.js', '/app.css']);

export interface StaticFile {
  bytes: Uint8Array;
  contentType: string;
  immutable: boolean;
}

const cache = new Map<string, StaticFile>();

async function load(relative: string, immutable: boolean): Promise<StaticFile | null> {
  const cached = cache.get(relative);
  if (cached) return cached;
  const extension = relative.slice(relative.lastIndexOf('.'));
  const contentType = TYPES[extension];
  if (!contentType) return null;
  try {
    const bytes = new Uint8Array(await readFile(resolve(publicDir, relative.slice(1))));
    const file: StaticFile = { bytes, contentType, immutable };
    cache.set(relative, file);
    return file;
  } catch {
    return null;
  }
}

/** Only the built frontend, its stylesheet and its own fonts are ever served. */
export async function staticFile(path: string): Promise<StaticFile | null> {
  if (SERVED.has(path)) return load(path, false);
  if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(path)) return load(path, true);
  return null;
}

export async function appShell(): Promise<StaticFile> {
  const file = await load('/index.html', false);
  if (!file) throw new Error('the built frontend is missing');
  return file;
}

const CLIENT_ROUTES: readonly RegExp[] = [
  /^\/$/,
  /^\/sign-in$/,
  /^\/sign-up$/,
  /^\/workspaces\/new$/,
  /^\/w\/[^/]+$/,
  /^\/w\/[^/]+\/p\/[^/]+$/,
  /^\/w\/[^/]+\/s\/[^/]+$/,
  /^\/w\/[^/]+\/settings$/,
  /^\/w\/[^/]+\/activity$/,
  /^\/invite\/[^/]+$/,
  /^\/lab\/[^/]+$/,
  /^\/view\/[^/]+$/,
  /^\/view\/[^/]+\/s\/[^/]+$/,
];

export function isClientRoute(path: string): boolean {
  return CLIENT_ROUTES.some((pattern) => pattern.test(path));
}
