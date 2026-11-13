/**
 * The built stylesheet, the browser bundle and the bundled typefaces. Nothing else under
 * the app directory is served: source files, the run manifest, the package files and
 * anything under `.git` are not routes, so they answer 404 like any unknown address.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Route } from './router';
import { apiError } from './errors';

const PUBLIC_DIR = join(__dirname, '..', 'public');

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
};

function readPublicFile(name: string): { bytes: Buffer; contentType: string } {
  const extension = name.slice(name.lastIndexOf('.'));
  const contentType = TYPES[extension];
  if (contentType === undefined) throw apiError('owner', 404, 'not_found');
  try {
    return { bytes: readFileSync(join(PUBLIC_DIR, name)), contentType };
  } catch {
    throw apiError('owner', 404, 'not_found');
  }
}

function asset(pattern: string, name: (params: Readonly<Record<string, string>>) => string): Route {
  return {
    method: 'GET',
    pattern,
    audience: 'owner',
    handler: async (context) => {
      const file = readPublicFile(name(context.params));
      return {
        status: 200,
        body: file.bytes,
        contentType: file.contentType,
        headers: { 'cache-control': 'no-cache' },
      };
    },
  };
}

export const staticRoutes: readonly Route[] = [
  asset('/styles.css', () => 'styles.css'),
  asset('/app.js', () => 'app.js'),
  // A font name is matched against the published set, so no path can be walked.
  asset('/fonts/:file', (params) => {
    const file = params['file'] ?? '';
    if (!/^[a-z0-9-]+\.woff2$/.test(file)) throw apiError('owner', 404, 'not_found');
    return `fonts/${file}`;
  }),
];
