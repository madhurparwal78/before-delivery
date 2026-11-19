/**
 * The app: configuration from the environment, schema setup and seeding on
 * start, health at all times, and static serving of the built client.
 */
import http, { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Database } from './db.js';
import { Storage, objectKey } from './storage.js';
import { seedIfEmpty } from './seed.js';
import { handleApi, Services, AppConfig } from './routes.js';
import { readBody, boundaryCheck, contentTypeCheck, payloadTooLarge } from './boundary.js';
import { parseJson } from '../shared/decimal.js';
import { ApiError, errorBody } from '../shared/errors.js';
import { personForSession } from './auth.js';

const config = (): AppConfig => {
  const port = parseInt(process.env.APP_PUBLIC_PORT ?? '4173', 10);
  const publicUrl = process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`;
  return {
    publicUrl,
    mailFrom: process.env.MAIL_FROM ?? 'Tallyframe <invites@harbourlane.test>',
    smtpHost: process.env.SMTP_HOST ?? 'mailpit',
    smtpPort: parseInt(process.env.SMTP_PORT ?? '1025', 10),
    ttlSeconds: parseInt(process.env.IDEMPOTENCY_TTL_SECONDS ?? '86400', 10),
  };
};

const s3 = () =>
  new Storage({
    endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'gf-dev',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const CLIENT_DIR = join(process.cwd(), 'dist', 'client');
const PUBLIC_DIR = join(process.cwd(), 'public');

function serveStatic(res: ServerResponse, path: string): boolean {
  const candidates = [
    join(CLIENT_DIR, path),
    join(PUBLIC_DIR, path),
  ];
  for (const file of candidates) {
    if (!file.startsWith(CLIENT_DIR) && !file.startsWith(PUBLIC_DIR)) continue;
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    const body = readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return true;
  }
  return false;
}

function serveShell(res: ServerResponse): void {
  const shell = join(CLIENT_DIR, 'index.html');
  if (existsSync(shell)) {
    const body = readFileSync(shell);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('<!DOCTYPE html><title>Tallyframe</title><p>The client build is missing.</p>');
}

const parseCookies = (header: string | undefined): Map<string, string> => {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return out;
};

async function main(): Promise<void> {
  const appConfig = config();
  const db = Database.connect(process.env.DATABASE_URL ?? 'postgresql://localhost:5432/tallyframe');
  const storage = s3();
  const services: Services = { db, storage, config: appConfig };

  // setup + seed, retried until they succeed; the server starts regardless
  let ready = false;
  let setupRunning: Promise<void> | null = null;
  const ensureReady = (): Promise<void> => {
    if (ready) return Promise.resolve();
    if (!setupRunning) {
      setupRunning = (async () => {
        await db.setup();
        await db.transaction(async (client) => {
          await seedIfEmpty(client);
        });
        try {
          if (!(await storage.headBucket())) {
            await storage.createBucket();
          }
        } catch {
          // storage may be down at boot; exports will surface failures
        }
        ready = true;
      })().catch((err) => {
        console.error('setup failed:', err instanceof Error ? err.message : err);
        setupRunning = null;
      });
    }
    return setupRunning;
  };
  void ensureReady();

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;

      if (pathname.startsWith('/api/')) {
        const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? 'GET');
        const bodyRead = await readBody(req);
        const jsonHead = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
        if (bodyRead.tooLarge) {
          const body = JSON.stringify(errorBody(payloadTooLarge()));
          res.writeHead(413, jsonHead);
          res.end(body);
          return;
        }
        const mediaError = contentTypeCheck(req);
        if (mediaError) {
          const body = JSON.stringify(errorBody(mediaError));
          res.writeHead(415, jsonHead);
          res.end(body);
          return;
        }
        const originError = boundaryCheck(req, isStateChanging, appConfig.publicUrl).error;
        if (originError) {
          const body = JSON.stringify(errorBody(originError));
          res.writeHead(403, jsonHead);
          res.end(body);
          return;
        }
        let body: unknown = undefined;
        if (bodyRead.text.length > 0) {
          try {
            body = parseJson(bodyRead.text);
          } catch {
            const err = new ApiError(400, 'invalid_json', 'The request body is not valid JSON.');
            const out = JSON.stringify(errorBody(err));
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(out);
            return;
          }
        }
        if (pathname !== '/api/health') {
          await ensureReady();
        }
        const cookies = parseCookies(req.headers.cookie);
        const sessionToken = cookies.get('tf_session');
        const personRow = sessionToken
          ? await db
              .withClient((client) => personForSession(client, sessionToken))
              .catch(() => null)
          : null;
        const person = personRow
          ? { id: personRow.id, email: personRow.email, displayName: personRow.display_name }
          : null;
        await handleApi({
          req,
          res,
          services,
          pathname,
          query: url.searchParams,
          bodyText: bodyRead.text,
          body,
          sessionToken,
          person,
        });
        return;
      }

      if (serveStatic(res, pathname === '/' ? 'index.html' : pathname.slice(1))) return;
      if (pathname === '/' || !pathname.startsWith('/api')) {
        serveShell(res);
        return;
      }
      serveShell(res);
    } catch (err) {
      const isDown =
        err instanceof Error &&
        (err.message.includes('ECONNREFUSED') || err.message.includes('connection terminated'));
      const apiErr = isDown
        ? new ApiError(503, 'database_unavailable', 'The database is unreachable.')
        : new ApiError(500, 'internal', 'Something went wrong.');
      if (!res.headersSent) {
        const body = JSON.stringify(errorBody(apiErr));
        res.writeHead(apiErr.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(body);
      } else {
        res.end();
      }
    }
  });

  const port = parseInt(process.env.APP_PUBLIC_PORT ?? '4173', 10);
  server.listen(port, '0.0.0.0', () => {
    console.log(`tallyframe listening on 0.0.0.0:${port}`);
  });
  void objectKey;
}

void main();
