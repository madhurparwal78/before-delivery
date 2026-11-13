// The server: one origin, published limits, uploads, pages, and boot (DP-39, DP-42).

import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { APP_PUBLIC_PORT } from './config.js';
import { pool } from './db.js';
import { applySchema } from './schema.js';
import { createApiRouter, type ApiContext } from './api/routes.js';
import { crossOrigin, errorBody, tooLarge, unsupportedMediaType } from './api/errors.js';
import { KillBillClient } from './providers/killbill.js';
import { StorageProvider } from './providers/storage.js';
import { Mailer } from './providers/mail.js';
import { ProviderHealth } from './providers/health.js';
import {
  DATABASE_URL,
  KILLBILL_API_KEY,
  KILLBILL_API_SECRET,
  KILLBILL_PASSWORD,
  KILLBILL_URL,
  KILLBILL_USERNAME,
  MAIL_FROM,
  S3_ACCESS_KEY_ID,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_FORCE_PATH_STYLE,
  S3_REGION,
  S3_SECRET_ACCESS_KEY,
  SMTP_HOST,
  SMTP_PORT,
} from './config.js';
import { servePages } from './pages.js';

const JSON_BODY_LIMIT = 100000;
const UPLOAD_LIMIT = 5000000;

async function waitForPostgres(): Promise<void> {
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error('Postgres unreachable at boot');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main(): Promise<void> {
  await waitForPostgres();
  await applySchema();

  const killbill = new KillBillClient({
    url: KILLBILL_URL,
    username: KILLBILL_USERNAME,
    password: KILLBILL_PASSWORD,
    apiKey: KILLBILL_API_KEY,
    apiSecret: KILLBILL_API_SECRET,
  });
  const storage = new StorageProvider({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    forcePathStyle: S3_FORCE_PATH_STYLE,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  });
  await storage.ensureBucket();
  const mailer = new Mailer({ host: SMTP_HOST, port: SMTP_PORT, from: MAIL_FROM });
  const health = new ProviderHealth(killbill, storage, mailer);
  const context: ApiContext = { killbill, storage, mailer, health };

  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());

  // Same-origin only: a differing Origin on a state change is refused (DP-42).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin !== undefined &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      origin !== `${req.protocol}://${req.get('host')}`
    ) {
      res.status(403).json(errorBody(crossOrigin()));
      return;
    }
    next();
  });

  const api = express.Router();

  api.use((req, res, next) => {
    const contentType = req.headers['content-type'] ?? '';
    const isUpload = req.path === '/bookings' && req.method === 'POST'
      ? false
      : (req.path.endsWith('/certificate') && req.method === 'POST')
        || (req.path.endsWith('/photos') && req.method === 'POST');
    const expectsMultipart = isUpload;
    if (expectsMultipart) {
      if (!contentType.startsWith('multipart/form-data')) {
        res.status(415).json(errorBody(unsupportedMediaType()));
        return;
      }
      handleUpload(req, res, next);
      return;
    }
    if (contentType !== '' && !contentType.startsWith('application/json')) {
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        res.status(415).json(errorBody(unsupportedMediaType()));
        return;
      }
    }
    handleJson(req, res, next);
  });

  api.use(createApiRouter(context));

  api.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'not_found', message: 'We could not find that' } });
  });

  app.use('/api', api);
  servePages(app);

  app.listen(APP_PUBLIC_PORT, '0.0.0.0');
  void DATABASE_URL;
}

function handleJson(req: Request, res: Response, next: NextFunction): void {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > JSON_BODY_LIMIT) {
      res.status(413).json(errorBody(tooLarge()));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    (req as Request & { rawBody?: string }).rawBody = raw;
    if (raw.length === 0) {
      (req as Request & { parsedBody?: unknown }).parsedBody = {};
    } else {
      try {
        (req as Request & { parsedBody?: unknown }).parsedBody = JSON.parse(raw);
      } catch {
        res.status(400).json({ error: { code: 'bad_request', message: 'Send valid JSON' } });
        return;
      }
    }
    next();
  });
  req.on('error', () => {
    if (!res.headersSent) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Could not read the request' } });
    }
  });
}

interface UploadParts {
  phase?: string;
  serial?: string;
  file?: Uint8Array;
  passcode?: string;
}

function handleUpload(req: Request, res: Response, next: NextFunction): void {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type'] ?? '');
  if (boundaryMatch === null) {
    res.status(415).json(errorBody(unsupportedMediaType()));
    return;
  }
  const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`;
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  req.on('data', (chunk: Buffer) => {
    if (aborted) {
      return;
    }
    size += chunk.length;
    if (size > UPLOAD_LIMIT + 4096) {
      aborted = true;
      res.status(413).json(errorBody(tooLarge()));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) {
      return;
    }
    const body = Buffer.concat(chunks);
    const parts = parseMultipart(body, boundary);
    if (parts.file !== undefined && parts.file.length > UPLOAD_LIMIT) {
      res.status(413).json(errorBody(tooLarge()));
      return;
    }
    (req as Request & { upload?: UploadParts }).upload = parts;
    next();
  });
  req.on('error', () => {
    if (!res.headersSent) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Could not read the upload' } });
    }
  });
}

function parseMultipart(body: Buffer, boundary: string): UploadParts {
  const parts: UploadParts = {};
  const boundaryBuffer = Buffer.from(boundary);
  let start = body.indexOf(boundaryBuffer);
  while (start !== -1) {
    const contentStart = start + boundaryBuffer.length;
    const next = body.indexOf(boundaryBuffer, contentStart);
    if (next === -1) {
      break;
    }
    const segment = body.subarray(contentStart, next);
    const headerEnd = segment.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = segment.subarray(0, headerEnd).toString('utf8');
      const nameMatch = /name="([^"]*)"/i.exec(headerText);
      const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
      const content = segment.subarray(headerEnd + 4, segment.length - 2);
      if (nameMatch !== null) {
        const name = nameMatch[1];
        if (filenameMatch !== null || name === 'file') {
          parts.file = new Uint8Array(content);
        } else if (name === 'phase' || name === 'serial' || name === 'passcode') {
          parts[name] = content.toString('utf8');
        }
      }
    }
    start = next;
  }
  return parts;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'boot failed';
  console.error(message);
  process.exit(1);
});

export type { PoolClient };
