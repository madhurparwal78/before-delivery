import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Reply } from './http/router';

const PUBLIC_ROOT = join(__dirname, '..', 'public');

const ASSET_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const APP_SHELL_PREFIXES = ['/desk', '/inspect'];

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function assetExtension(pathname: string): string | null {
  const dot = pathname.lastIndexOf('.');
  if (dot === -1) return null;
  const extension = pathname.slice(dot);
  return ASSET_TYPES[extension] === undefined ? null : extension;
}

function isAppShellPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return APP_SHELL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Serves the built client assets and the app shell; nothing else. */
export async function serveStatic(pathname: string): Promise<Reply | null> {
  if (isAppShellPath(pathname)) {
    const html = await readFile(join(PUBLIC_ROOT, 'index.html'));
    return {
      status: 200,
      bytes: html,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'Cache-Control': 'no-store',
      },
    };
  }
  const extension = assetExtension(pathname);
  if (extension === null) return null;
  if (pathname.includes('..') || pathname.includes('\0')) return null;
  const file = await readFile(join(PUBLIC_ROOT, pathname)).catch(() => null);
  if (file === null) return null;
  return {
    status: 200,
    bytes: file,
    headers: {
      'Content-Type': ASSET_TYPES[extension] as string,
      'Cache-Control': 'public, max-age=3600',
    },
  };
}
