import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { problem, ProblemError } from './problem.js';
import { checkOrigin, decodedPath, sendProblem, sendReply } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(here, '..', 'public');

const CLIENT_ROUTES = [
  /^\/$/,
  /^\/sites$/,
  /^\/sites\/[^/]+\/survey$/,
  /^\/sites\/[^/]+\/layouts\/[^/]+$/,
  /^\/kit$/,
  /^\/hire$/,
  /^\/sheets\/[^/]+$/,
  /^\/rig\/[^/]+$/,
];

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function contentType(path: string): string {
  const dot = path.lastIndexOf('.');
  return TYPES[path.slice(dot)] ?? 'application/octet-stream';
}

async function readPublic(relative: string): Promise<Buffer | null> {
  const target = join(publicRoot, normalize(relative));
  if (!target.startsWith(publicRoot)) return null;
  try {
    const facts = await stat(target);
    if (!facts.isFile()) return null;
    return await readFile(target);
  } catch {
    return null;
  }
}

export async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const head = request.method === 'HEAD';
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      checkOrigin(request);
      throw problem('method_not_allowed', { headers: { Allow: 'GET, HEAD' } });
    }
    const path = decodedPath(request);
    if (path.split('/').some((part) => part.startsWith('.'))) throw problem('not_found');
    const onRig = path.startsWith('/rig/');
    if (CLIENT_ROUTES.some((pattern) => pattern.test(path))) {
      const shell = await readPublic('index.html');
      if (shell === null) throw problem('not_found');
      sendReply(
        response,
        {
          status: 200,
          raw: shell,
          contentType: TYPES['.html'],
          headers: onRig
            ? { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
            : { 'Cache-Control': 'no-cache' },
        },
        head,
      );
      return;
    }
    const file = await readPublic(path);
    if (file === null) throw problem('not_found');
    sendReply(
      response,
      {
        status: 200,
        raw: file,
        contentType: contentType(path),
        headers: {
          ETag: `"${createHash('sha256').update(file).digest('hex').slice(0, 32)}"`,
          'Cache-Control': path.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      },
      head,
    );
  } catch (error) {
    if (error instanceof ProblemError) sendProblem(response, error, head);
    else sendProblem(response, problem('internal_error'), head);
  }
}
