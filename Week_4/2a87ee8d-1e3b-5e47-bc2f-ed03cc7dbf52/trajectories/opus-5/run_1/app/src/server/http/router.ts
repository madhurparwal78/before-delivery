import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RouteDefinition } from './pipeline.js';
import { runRoute } from './pipeline.js';
import type { RequestContext } from './context.js';
import { sendBytes, sendJson } from './respond.js';

interface CompiledRoute {
  readonly definition: RouteDefinition;
  readonly segments: readonly string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(definition: RouteDefinition): void {
    this.routes.push({ definition, segments: definition.path.split('/').filter((part) => part !== '') });
  }

  addAll(definitions: readonly RouteDefinition[]): void {
    for (const definition of definitions) this.add(definition);
  }

  /** Returns false when no route matches the path and method. */
  async dispatch(context: RequestContext): Promise<boolean> {
    const parts = context.path.split('/').filter((part) => part !== '');
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (params === null) continue;
      pathMatched = true;
      if (route.definition.method !== context.method) continue;
      context.params = params;
      await runRoute(route.definition, context);
      return true;
    }
    if (pathMatched) {
      sendJson(context, 405, { error: { code: 'not_found', message: 'Not found' } });
      return true;
    }
    return false;
  }
}

function matchSegments(
  pattern: readonly string[],
  parts: readonly string[],
): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index] as string;
    const actual = parts[index] as string;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

const CLIENT_ROOT = resolve(fileURLToPath(new URL('../../client', import.meta.url)));

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

/** The client routes that render the single-page app. Any other path is not served. */
const CLIENT_PAGE_PATTERNS: readonly RegExp[] = [
  /^\/$/,
  /^\/signin$/,
  /^\/workshops$/,
  /^\/billing$/,
  /^\/activity$/,
  /^\/join\/[^/]+$/,
  /^\/w\/[^/]+$/,
  /^\/recap\/[^/]+$/,
];

async function readAsset(relativePath: string): Promise<Buffer | null> {
  // Keep the resolved path inside the built client directory.
  const target = join(CLIENT_ROOT, normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!target.startsWith(CLIENT_ROOT)) return null;
  try {
    const info = await stat(target);
    if (!info.isFile()) return null;
    return await readFile(target);
  } catch {
    return null;
  }
}

/**
 * Serves only built client assets. Source files, manifests, lockfiles, dotfiles and source
 * maps are never served, and no other path is either.
 */
export async function serveClient(context: RequestContext): Promise<boolean> {
  if (context.method !== 'GET' && context.method !== 'HEAD') return false;

  if (CLIENT_PAGE_PATTERNS.some((pattern) => pattern.test(context.path))) {
    const page = await readAsset('index.html');
    if (page === null) return false;
    sendBytes(context, 200, page, CONTENT_TYPES['.html'] as string, { 'Cache-Control': 'no-store' });
    return true;
  }

  const extension = extname(context.path).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  // Only the asset kinds the client ships are servable, and never a source map.
  if (contentType === undefined || extension === '.map') return false;
  if (context.path.split('/').some((part) => part.startsWith('.'))) return false;

  const asset = await readAsset(context.path);
  if (asset === null) return false;
  const immutable = context.path.startsWith('/assets/');
  sendBytes(context, 200, asset, contentType, {
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  return true;
}
