import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config';
import { migrate, waitForDatabase } from './db';
import { seed, startSeedBillingLoop } from './seed';
import { ApiError } from './http/errors';
import { Reply, dispatch } from './http/kernel';
import { matchAppRoute } from './shared/routes';
import { PaymentsUnavailable } from './services/killbill';
import { ReportStoreUnavailable, ensureBucket } from './services/s3';
import { startMailLoop } from './services/mailer';
import { startMembershipLoop } from './services/memberships';
import { startErasureLoop } from './services/erasure';
import { apiRoutes } from './api';
import {
  attachmentStoreUnavailable,
  paymentsUnavailable,
  reportStoreUnavailable,
} from './http/errors';

const PUBLIC_DIR = join(__dirname, 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (reply.json !== undefined) {
    const body = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = String(body.length);
    res.writeHead(reply.status, headers);
    res.end(body);
    return;
  }
  if (reply.bytes) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    headers['Content-Length'] = String(reply.bytes.length);
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
    return;
  }
  res.writeHead(reply.status, headers);
  res.end();
}

function apiErrorOf(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof PaymentsUnavailable) return paymentsUnavailable();
  if (error instanceof ReportStoreUnavailable) return reportStoreUnavailable();
  return new ApiError(500, 'server_error', 'Something went wrong here.');
}

async function serveAsset(path: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) return null;
  try {
    const bytes = await readFile(file);
    return { bytes, contentType: CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api')) {
    try {
      send(res, await dispatch(apiRoutes, req, res, url));
    } catch (error) {
      const apiError = apiErrorOf(error);
      if (apiError.status === 500) {
        process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
      }
      send(res, {
        status: apiError.status,
        json: apiError.body(),
        headers: apiError.headers,
      });
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, { status: 405, headers: { Allow: 'GET, HEAD' } });
    return;
  }
  if (url.pathname !== '/' && !url.pathname.endsWith('/')) {
    const asset = await serveAsset(url.pathname);
    if (asset) {
      send(res, { status: 200, bytes: asset.bytes, contentType: asset.contentType });
      return;
    }
  }
  const page = await serveAsset('index.html');
  if (!page) {
    send(res, { status: 500, bytes: Buffer.from('No built assets'), contentType: 'text/plain' });
    return;
  }
  send(res, {
    status: matchAppRoute(url.pathname) ? 200 : 404,
    bytes: page.bytes,
    contentType: 'text/html; charset=utf-8',
  });
}

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate();
  await seed();
  void ensureBucket().catch(() => undefined);
  startMailLoop();
  startMembershipLoop();
  startSeedBillingLoop();
  startErasureLoop();
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        send(res, { status: 500, json: { error: { code: 'server_error', message: 'Something went wrong here.' } } });
      }
    });
  });
  server.listen(config.publicPort, '0.0.0.0');
}

void main();

export { attachmentStoreUnavailable };
