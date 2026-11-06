import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from '../http/errors.js';
import { claimPage, consolePage, gamePage } from '../pages/appPages.js';
import type { AppRoute } from '../http/app.js';

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

const html = (body: string): { status: number; body: string; contentType: string } => ({
  status: 200,
  body,
  contentType: 'text/html; charset=utf-8',
});

export const pageRoutes: AppRoute[] = [
  { method: 'GET', pattern: '/', auth: 'anyone', bodyKind: 'none', handler: async () => html(gamePage()) },
  {
    method: 'GET',
    pattern: '/claim',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async () => html(claimPage()),
  },
  {
    method: 'GET',
    pattern: '/console',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async () => html(consolePage()),
  },
  {
    method: 'GET',
    pattern: '/assets/*',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async (context) => {
      const relative = normalize(context.url.pathname.slice('/assets/'.length));
      if (relative.startsWith('..') || relative.includes('\0')) throw fail('not_found');
      const extension = relative.slice(relative.lastIndexOf('.'));
      const contentType = CONTENT_TYPES[extension];
      if (contentType === undefined) throw fail('not_found');
      let bytes: Buffer;
      try {
        bytes = await readFile(join(publicRoot, relative));
      } catch {
        throw fail('not_found');
      }
      return {
        status: 200,
        body: bytes,
        contentType,
        headers: { 'Cache-Control': 'no-cache' },
      };
    },
  },
];
