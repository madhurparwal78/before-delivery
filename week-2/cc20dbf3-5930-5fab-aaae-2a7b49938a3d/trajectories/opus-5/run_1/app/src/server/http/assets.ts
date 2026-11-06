import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const PRIVATE_ROOTS = new Set(['src', 'node_modules', 'dist', 'scripts']);

export interface AssetResponse {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly immutable: boolean;
}

function isPrivatePath(path: string): boolean {
  const parts = path.split('/').filter((part) => part !== '');
  if (parts.some((part) => part === '..' || part === '.' || part.startsWith('.'))) return true;
  const first = parts[0];
  return first !== undefined && PRIVATE_ROOTS.has(first);
}

function extensionOf(path: string): string | null {
  const parts = path.split('/');
  const last = parts[parts.length - 1] ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot) : null;
}

/**
 * Serves the built browser assets, and the app shell for the app's own routes.
 * Nothing outside the asset folder is reachable, and files that look like
 * sources or configuration answer not found.
 */
export class AssetServer {
  private readonly root: string;
  private readonly cache = new Map<string, AssetResponse>();

  constructor(root: string) {
    this.root = root;
  }

  async shell(): Promise<AssetResponse | null> {
    return this.readAsset('/index.html', false);
  }

  async resolve(path: string): Promise<AssetResponse | null> {
    if (path.includes('%2e%2e') || path.includes('%2E%2E')) return null;
    if (isPrivatePath(path)) return null;
    const extension = extensionOf(path);
    if (extension === null) return this.shell();
    return this.readAsset(path, extension === '.woff2' || path.startsWith('/assets/'));
  }

  private async readAsset(path: string, immutable: boolean): Promise<AssetResponse | null> {
    const cached = this.cache.get(path);
    if (cached !== undefined) return cached;
    const relative = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolute = join(this.root, relative);
    if (!absolute.startsWith(this.root)) return null;
    let bytes: Buffer;
    try {
      bytes = await readFile(absolute);
    } catch {
      return null;
    }
    const extension = extensionOf(path) ?? '.html';
    const response: AssetResponse = {
      bytes,
      contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
      immutable,
    };
    this.cache.set(path, response);
    return response;
  }
}
