/** Page paths, the built assets and the sign-in landing redirects. */

import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { deskPath, isDeskOnlyPath, isPagePath, mayOpenPath } from '../shared/desk.js';
import type { Session } from './sessions.js';

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

export interface PageDeps {
  publicDir: string;
}

/** Where a visit lands, or null when the asked-for page is served as it is. */
export function landing(path: string, session: Session | null): string | null {
  if (session === null) return isDeskOnlyPath(path) ? '/sign-in' : null;
  if (path === '/sign-in') return deskPath(session.role);
  if (isDeskOnlyPath(path) && !mayOpenPath(session.role, path)) return deskPath(session.role);
  return null;
}

async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    const held = await stat(path);
    if (!held.isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

export async function servePage(
  deps: PageDeps,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  session: Session | null,
): Promise<void> {
  if (path.startsWith('/assets/')) {
    const wanted = join(deps.publicDir, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const bytes = await readIfPresent(wanted);
    const contentType = ASSET_TYPES[extname(wanted)];
    if (bytes === null || contentType === undefined) {
      await sendShell(deps, request, response, 404);
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
    return;
  }

  if (!isPagePath(path)) {
    await sendShell(deps, request, response, 404);
    return;
  }

  const goTo = landing(path, session);
  if (goTo !== null) {
    response.writeHead(302, { Location: goTo, 'Content-Length': '0' });
    response.end();
    return;
  }
  await sendShell(deps, request, response, 200);
}

async function sendShell(
  deps: PageDeps,
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
): Promise<void> {
  const bytes = await readFile(join(deps.publicDir, 'index.html'));
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'no-cache',
  });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}
