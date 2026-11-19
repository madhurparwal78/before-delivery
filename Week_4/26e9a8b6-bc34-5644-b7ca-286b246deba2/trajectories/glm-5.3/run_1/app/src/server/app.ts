// HTTP server: published routes, one error shape, page routes for the app shell.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Db } from './db';
import { Store } from './store';
import { S3 } from './s3';
import { Smtp } from './mail';
import { LiveHub } from './live';
import { Config } from './config';
import { limits } from './limits';
import { api, type ApiContext } from './api';
import { seed, makeWorld } from './seed';
import { renderPage } from './pages';

export class App {
  readonly db: Db;
  readonly store: Store;
  readonly s3: S3;
  readonly smtp: Smtp;
  readonly live: LiveHub;
  private publicDir: string;

  constructor(readonly config: Config) {
    this.db = new Db(config.databaseUrl);
    this.store = new Store(this.db);
    this.s3 = new S3(config.s3);
    this.smtp = new Smtp(config.smtp);
    this.live = new LiveHub();
    this.publicDir = join(process.cwd(), 'public');
  }

  async start(): Promise<void> {
    // Wait for Postgres before listening; come up even when MinIO is out.
    await this.waitForPostgres();
    await seed(this.db, this.s3, join(process.cwd(), 'public', 'samples')).catch((error) => {
      console.error('seed failed', error);
    });
    const server = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        console.error('handler failed', error);
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'application/json' });
        }
        response.end(JSON.stringify({ error: 'internal' }));
      });
    });
    server.listen(this.config.port, '0.0.0.0');
    console.log(`pennywasher listening on 0.0.0.0:${this.config.port}`);
  }

  private async waitForPostgres(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (await this.db.check()) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 + attempt * 250, 3000)));
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = (request.method ?? 'GET').toUpperCase();

    // Same-origin only: published routes, nothing else.
    if (path.startsWith('/api/') || (path.startsWith('/samples/') && method === 'GET')) {
      await this.handleApi(request, response, url);
      return;
    }
    await this.handlePage(request, response, url);
  }

  private async handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const context: ApiContext = {
      app: this,
      request,
      response,
      url,
      method: (request.method ?? 'GET').toUpperCase(),
    };
    await api(context);
  }

  private async handlePage(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname;
    const method = (request.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      // Static assets from the app's own origin only.
      if (path.startsWith('/assets/')) {
        this.serveAsset(response, path);
        return;
      }
      if (path === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
      }
      const embed = path.startsWith('/embed/');
      const framing = embed ? 'frame-ancestors *' : "frame-ancestors 'self'";
      const headers: Record<string, string> = {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': framing,
      };
      if (embed) {
        // Embed responses set no cookie and never show an account name.
        headers['cache-control'] = 'no-store';
      }
      // A slug route answers 404 when its record does not exist or is not visible.
      let status = 200;
      const slug = path.split('/')[2] ?? '';
      if (slug.length > 0 && (path.startsWith('/g/') || path.startsWith('/edit/') || path.startsWith('/c/') || embed)) {
        status = (await this.recordVisible(request, path, slug)) ? 200 : 404;
      } else if (!isKnownPageRoute(path, embed)) {
        status = 404;
      }
      const html = renderPage(this.config, path, embed);
      response.writeHead(status, headers);
      response.end(html.body);
      return;
    }
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'method_not_allowed' }));
  }

  /** The record behind a slug route, with visibility applied. */
  private async recordVisible(request: IncomingMessage, path: string, slug: string): Promise<boolean> {
    if (path.startsWith('/c/')) {
      const collection = await this.store.collectionById(slug);
      if (!collection) return false;
      return collection.visibility === 'public' || (await this.sessionUserOf(request))?.id === collection.owner_id;
    }
    const guide = (await this.store.guideBySlug(slug)) ?? (await this.store.guideById(slug));
    if (!guide) return false;
    const viewer = await this.sessionUserOf(request);
    const isCoauthor = viewer ? await this.store.isCoauthor(guide.id, viewer.id) : false;
    const isOwner = viewer?.id === guide.owner_id;
    if (path.startsWith('/edit/')) {
      return isOwner || isCoauthor;
    }
    // The reader and embed pages need a saved version and public visibility.
    if (guide.visibility === 'private' && !isOwner && !isCoauthor) return false;
    if (guide.state === 'draft' && !isOwner && !isCoauthor) return false;
    return guide.latest_version !== null;
  }

  private async sessionUserOf(request: IncomingMessage): Promise<{ id: string } | null> {
    const cookies: Record<string, string> = {};
    const raw = String(request.headers.cookie ?? '');
    for (const part of raw.split(';')) {
      const index = part.indexOf('=');
      if (index === -1) continue;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) cookies[key] = value;
    }
    const token = cookies['pw_session'];
    if (!token) return null;
    return this.store.sessionAccount(token);
  }

  private serveAsset(response: ServerResponse, path: string): void {
    const file = join(this.publicDir, path.replace(/^\/+/, ''));
    if (!file.startsWith(this.publicDir) || !existsSync(file)) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    const types: Record<string, string> = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.glb': 'model/gltf-binary',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    };
    const extension = extname(file);
    response.writeHead(200, {
      'content-type': types[extension] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=3600',
    });
    response.end(readFileSync(file));
  }
}

function isKnownPageRoute(path: string, embed: boolean): boolean {
  if (embed) return path.startsWith('/embed/');
  if (path === '/' || path === '/search' || path === '/signin' || path === '/signup' || path === '/confirm' || path === '/dashboard') return true;
  const slugPattern = /^[A-Za-z0-9-]+$/;
  if (path.startsWith('/g/') || path.startsWith('/edit/') || path.startsWith('/c/')) {
    return slugPattern.test(path.split('/')[2] ?? '');
  }
  return false;
}
