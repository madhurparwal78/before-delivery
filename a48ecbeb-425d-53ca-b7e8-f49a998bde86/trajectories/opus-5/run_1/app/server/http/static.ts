import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'client',
);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Paths the app never serves: source, manifests, lockfiles and anything hidden. */
const NEVER_SERVED = /(^|\/)(run\.json|package(-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[tj]s|\.env[^/]*|node_modules|server|shared|scripts|client\/src)(\/|$)/i;

export interface StaticFile {
  body: Buffer;
  contentType: string;
  immutable: boolean;
}

export function isForbiddenPath(urlPath: string): boolean {
  return (
    NEVER_SERVED.test(urlPath) ||
    urlPath.split('/').some((part) => part.startsWith('.') && part !== '') ||
    urlPath.endsWith('.ts') ||
    urlPath.endsWith('.tsx') ||
    urlPath.endsWith('.map')
  );
}

async function readFile(relative: string): Promise<StaticFile | null> {
  const resolved = path.resolve(CLIENT_ROOT, `.${relative}`);
  if (!resolved.startsWith(CLIENT_ROOT)) return null;
  try {
    const body = await fs.readFile(resolved);
    return {
      body,
      contentType: CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
      immutable: relative.startsWith('/assets/') || relative.startsWith('/fonts/'),
    };
  } catch {
    return null;
  }
}

export async function serveStatic(urlPath: string): Promise<StaticFile | null> {
  if (isForbiddenPath(urlPath)) return null;
  return readFile(urlPath);
}

/** A path that names a file, so a miss is a 404 rather than the app shell. */
export function looksLikeAFile(urlPath: string): boolean {
  return path.extname(urlPath) !== '';
}

/** Every unmatched page falls back to the app shell, which routes in the browser. */
export async function serveAppShell(): Promise<StaticFile | null> {
  return readFile('/index.html');
}
