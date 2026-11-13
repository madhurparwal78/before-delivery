// Serves the pages and static assets; never source, manifests or credentials (DP-42).

import type { Express, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(MODULE_DIR, '..');
const PUBLIC_DIR = existsSync(join(DIST_DIR, 'public'))
  ? join(DIST_DIR, 'public')
  : resolve(DIST_DIR, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const KIT_IDS: ReadonlyArray<string> = ['kestrel-lf', 'wren-s35', 'lantern-led'];

async function sendFile(res: Response, relativePath: string, status = 200): Promise<void> {
  try {
    const content = await readFile(join(PUBLIC_DIR, relativePath));
    const type = MIME[extname(relativePath)] ?? 'application/octet-stream';
    res.status(status).setHeader('Content-Type', type);
    res.send(content);
  } catch {
    res.status(404).send('Not found');
  }
}

export function servePages(app: Express): void {
  app.get(/^\/assets\/.+$/, (req: Request, res: Response) => {
    const relative = req.path.replace(/^\/+/, '').replace(/\.\./g, '');
    void sendFile(res, relative);
  });

  app.get('/favicon.svg', (_req: Request, res: Response) => {
    void sendFile(res, 'favicon.svg');
  });

  app.get('/', (_req: Request, res: Response) => {
    void sendFile(res, 'index.html');
  });

  app.get('/kits/:kitId', (req: Request, res: Response) => {
    if (KIT_IDS.includes(req.params.kitId)) {
      void sendFile(res, `kits/${req.params.kitId}.html`);
      return;
    }
    void sendFile(res, 'not-found.html', 404);
  });

  app.get('/bookings/:ref', (_req: Request, res: Response) => {
    void sendFile(res, 'booking.html');
  });

  app.get('/desk', (_req: Request, res: Response) => {
    void sendFile(res, 'desk.html');
  });

  app.get('/desk/counter', (_req: Request, res: Response) => {
    void sendFile(res, 'desk-counter.html');
  });

  app.get('/desk/owner', (_req: Request, res: Response) => {
    void sendFile(res, 'desk-owner.html');
  });

  // Everything else is the not-found page (DP-42: unknown page routes).
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: { code: 'not_found', message: 'We could not find that' } });
      return;
    }
    void sendFile(res, 'not-found.html', 404);
  });
}
