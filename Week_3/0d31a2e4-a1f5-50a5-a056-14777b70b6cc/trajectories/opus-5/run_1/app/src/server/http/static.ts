import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = fileURLToPath(new URL('../../../client/', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const FORBIDDEN_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'run.json',
  'tsconfig.json',
  'tsconfig.server.json',
  'tsconfig.client.json',
  'vite.config.ts',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

const FORBIDDEN_EXTENSIONS = new Set(['.ts', '.tsx', '.map', '.env']);

/** Source, manifests, lockfiles and dependencies are never served. */
export function isForbiddenPath(pathname: string): boolean {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  const name = parts[parts.length - 1] ?? '';
  if (parts.includes('node_modules') || parts.includes('src')) return true;
  if (name.startsWith('.env')) return true;
  if (FORBIDDEN_NAMES.has(name)) return true;
  return FORBIDDEN_EXTENSIONS.has(extname(name));
}

export interface StaticFile {
  body: Buffer;
  contentType: string;
}

async function readIfFile(path: string): Promise<Buffer | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return readFile(path);
  } catch {
    return null;
  }
}

export async function readClientFile(pathname: string): Promise<StaticFile | null> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\.]+)/, '');
  if (relative.split(sep).includes('..')) return null;
  const body = await readIfFile(join(CLIENT_ROOT, relative));
  if (body === null) return null;
  return { body, contentType: MIME[extname(relative)] ?? 'application/octet-stream' };
}

export async function readAppShell(): Promise<StaticFile> {
  const body = await readIfFile(join(CLIENT_ROOT, 'index.html'));
  if (body === null) throw new Error('the built browser app is missing');
  return { body, contentType: MIME['.html'] };
}
