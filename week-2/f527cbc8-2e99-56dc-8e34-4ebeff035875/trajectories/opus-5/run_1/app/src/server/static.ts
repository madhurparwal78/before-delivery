import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, extname, normalize } from 'node:path';
import { configureStatic } from './http.js';

/**
 * Only the built browser assets are served. Source files, the run manifest, package
 * files, lockfiles, environment files and any path with `..` are not served at all.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

export function installStatic(): void {
  const publicDir = resolve(import.meta.dirname, '..', 'public');
  const files = new Map<string, Buffer>();

  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(resolve(directory, entry.name), `${prefix}/${entry.name}`);
      else files.set(`${prefix}/${entry.name}`, readFileSync(resolve(directory, entry.name)));
    }
  };
  if (existsSync(publicDir)) walk(publicDir, '');

  const shellBody = files.get('/index.html') ?? Buffer.from('<!doctype html><title>Clinchline</title>');

  configureStatic(
    (pathname) => {
      if (pathname.includes('..') || normalize(pathname) !== pathname) return null;
      if (pathname === '/' || pathname === '/index.html') return null;
      const body = files.get(pathname);
      if (body === undefined) return null;
      const contentType = CONTENT_TYPES[extname(pathname)] ?? 'application/octet-stream';
      const headers = pathname.startsWith('/fonts/')
        ? { 'cache-control': 'public, max-age=31536000, immutable' }
        : { 'cache-control': 'no-cache' };
      return { body, contentType, headers };
    },
    () => ({ body: shellBody, contentType: 'text/html; charset=utf-8' }),
  );
}
