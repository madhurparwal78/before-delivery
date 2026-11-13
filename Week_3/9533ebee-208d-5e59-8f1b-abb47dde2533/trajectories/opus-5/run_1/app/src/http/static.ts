/**
 * Serving the built browser app from the same origin as the API. Only files
 * that are in the build are served: source, source maps, environment files,
 * lockfiles and manifests are not in `dist/public` and so cannot be reached.
 */

import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

export interface StaticAsset {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly immutable: boolean;
}

export class StaticFiles {
  private readonly files = new Map<string, StaticAsset>();

  /** Reads the build once, so only its own files can ever be served. */
  static async load(root: string): Promise<StaticFiles> {
    const served = new StaticFiles();
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const absolute = join(entry.parentPath, entry.name);
      const relative = absolute.slice(root.length).split('\\').join('/');
      const extension = extname(entry.name);
      served.files.set(relative, {
        bytes: await readFile(absolute),
        contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
        immutable: extension === '.woff2',
      });
    }
    return served;
  }

  get(path: string): StaticAsset | null {
    return this.files.get(path) ?? null;
  }

  indexDocument(): StaticAsset | null {
    return this.get('/index.html');
  }
}

/** True when the last path segment names a file extension. */
export function looksLikeFile(path: string): boolean {
  const lastSegment = path.split('/').pop() ?? '';
  return lastSegment.includes('.');
}
