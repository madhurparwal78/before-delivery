import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
};

// Only the built browser assets are served; everything else is refused.
const FORBIDDEN_PREFIXES = [
  '/run.json', '/package.json', '/package-lock.json', '/npm-shrinkwrap.json', '/tsconfig.json',
  '/src/', '/server-dist/', '/node_modules/', '/.env', '/scripts/', '/THIRD_PARTY_NOTICES.md',
];

function isForbiddenPath(path: string): boolean {
  if (path.includes('..')) return true;
  return FORBIDDEN_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

/** Serve only the built browser assets; never source, config or dependency files. */
export function registerStaticRoutes(app: FastifyInstance, clientDir: string, workerId: 1 | 2): void {
  const root = resolve(clientDir);

  const sendIndex = async (reply: import('fastify').FastifyReply): Promise<void> => {
    try {
      const index = await readFile(join(root, 'index.html'));
      reply.status(200).type('text/html; charset=utf-8').send(index);
    } catch {
      reply.status(500).type('text/html; charset=utf-8').send('<!DOCTYPE html><title>Kinfold</title>');
    }
  };

  const serveFile = async (path: string, reply: import('fastify').FastifyReply): Promise<boolean> => {
    const resolved = normalize(join(root, path));
    if (!resolved.startsWith(root)) return false;
    let stats;
    try {
      stats = await stat(resolved);
    } catch {
      return false;
    }
    if (!stats.isFile()) return false;
    const type = MIME_TYPES[extname(resolved).toLowerCase()] ?? 'application/octet-stream';
    const bytes = await readFile(resolved);
    reply.status(200).type(type).send(bytes);
    return true;
  };

  app.get('/*', async (request, reply) => {
    reply.header('X-Kinfold-Worker', String(workerId));
    const path = request.url.split('?')[0] ?? '/';
    if (isForbiddenPath(path)) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }
    if (path.startsWith('/api/')) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }
    const url = decodeURIComponent(path.replace(/^\/+/, ''));
    if (url === '') {
      await sendIndex(reply);
      return;
    }
    if (isForbiddenPath(url)) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }
    if (await serveFile(url, reply)) return;
    await sendIndex(reply);
  });

  app.setNotFoundHandler(async (request, reply) => {
    reply.header('X-Kinfold-Worker', String(workerId));
    const url = request.url.split('?')[0] ?? '/';
    if (url.startsWith('/api/')) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }
    await sendIndex(reply);
  });
}

export async function readAssetText(dir: string, name: string): Promise<string> {
  return readFile(join(dir, name), 'utf8');
}
