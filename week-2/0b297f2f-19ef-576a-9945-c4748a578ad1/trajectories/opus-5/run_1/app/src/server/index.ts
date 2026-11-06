import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { config, JSON_CONTENT_TYPE } from './config';
import { DatabaseUnavailableError } from './db/pool';
import { ensureDatabaseReady, markDatabaseNotReady } from './db/seed';
import { findSnapshotByToken, publishDuePreviews } from './domain/previewService';
import { getStaff } from './domain/repository';
import { ApiError, errors } from './http/errors';
import {
  serializeResult,
  writeApiError,
  writeResult,
  type ApiResult,
  type Ctx,
} from './http/http';
import { findStoredResponse, requestHash, storeResponse } from './http/idempotency';
import {
  renderLenderErrorPage,
  renderLenderPage,
  renderStaffShell,
} from './pages/html';
import { matchRoute, routeKey, type Route } from './routes/api';
import { ImageStoreUnavailableError } from './services/imageStore';
import { deliverPendingMail } from './services/mailer';
import { startStatusProbes } from './services/status';
import type { Snapshot } from '../shared/types';

const clientRoot = join(__dirname, '..', 'client');

const mediaTypes: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

function writeHtml(res: ServerResponse, status: number, html: string): void {
  const bytes = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}

function writeNotFound(res: ServerResponse): void {
  const bytes = Buffer.from('Not found', 'utf8');
  res.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': bytes.byteLength,
  });
  res.end(bytes);
}

async function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number,
): Promise<Buffer | null> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume();
    writeApiError(res, errors.bodyTooLarge());
    return null;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > maxBytes) {
      req.destroy();
      writeApiError(res, errors.bodyTooLarge());
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DatabaseUnavailableError) {
    markDatabaseNotReady();
    return errors.databaseUnavailable();
  }
  if (error instanceof ImageStoreUnavailableError) return errors.imageStoreUnavailable();
  process.stderr.write(`request failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  return new ApiError(500, 'internal_error', 'Something went wrong.');
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  query: URLSearchParams,
): Promise<void> {
  const segments = path.split('/').filter((segment) => segment !== '');
  const method = req.method ?? 'GET';
  if (segments[1] === 'p' && method !== 'GET') {
    req.resume();
    writeApiError(res, errors.readOnly());
    return;
  }
  const matched = matchRoute(method, segments);
  if (!matched) {
    req.resume();
    writeApiError(res, errors.notFound());
    return;
  }
  const route: Route = matched.route;
  const body = await readBody(req, res, route.maxBytes);
  if (body === null) return;

  const ctx: Ctx = {
    method,
    path,
    query,
    params: matched.params,
    headers: req.headers,
    body,
    res,
  };

  try {
    if (route.needsDatabase) {
      try {
        await ensureDatabaseReady();
      } catch (error) {
        throw new DatabaseUnavailableError(error);
      }
    }
    let staffId = req.headers['x-staff-id'];
    if (Array.isArray(staffId)) staffId = staffId[0];
    let staff = null;
    if (route.needsStaff) {
      staff = staffId === undefined ? null : await getStaff(staffId);
      if (!staff) throw errors.unknownStaff();
    }

    let idempotencyKey = req.headers['idempotency-key'];
    if (Array.isArray(idempotencyKey)) idempotencyKey = idempotencyKey[0];
    const useIdempotency = route.idempotent && staff !== null && idempotencyKey !== undefined;
    const hash = requestHash(method, path, body);
    if (useIdempotency && staff && idempotencyKey) {
      const stored = await findStoredResponse(staff.id, routeKey(route), idempotencyKey, hash);
      if (stored) {
        writeResult(res, {
          status: stored.status,
          bytes: stored.body,
          contentType: JSON_CONTENT_TYPE,
        });
        return;
      }
    }

    let result: ApiResult;
    try {
      result = await route.handle(ctx, staff as NonNullable<typeof staff>);
    } catch (error) {
      const apiError = toApiError(error);
      if (useIdempotency && staff && idempotencyKey && apiError.status < 500) {
        const serialized = Buffer.from(JSON.stringify(apiError.body()), 'utf8');
        await storeResponse(
          staff.id,
          routeKey(route),
          idempotencyKey,
          hash,
          apiError.status,
          serialized,
        );
      }
      throw apiError;
    }
    if (useIdempotency && staff && idempotencyKey) {
      const serialized = serializeResult(result);
      await storeResponse(
        staff.id,
        routeKey(route),
        idempotencyKey,
        hash,
        result.status,
        serialized.bytes,
      );
    }
    writeResult(res, result);
  } catch (error) {
    writeApiError(res, toApiError(error));
  }
}

function serveStatic(path: string, res: ServerResponse): boolean {
  const relative = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = join(clientRoot, relative);
  if (!file.startsWith(clientRoot) || !existsSync(file) || !statSync(file).isFile()) return false;
  const type = mediaTypes[extname(file)];
  if (!type) return false;
  res.writeHead(200, {
    'content-type': type,
    'content-length': statSync(file).size,
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(res);
  return true;
}

async function handleLenderPage(res: ServerResponse, token: string): Promise<void> {
  let snapshot: Awaited<ReturnType<typeof findSnapshotByToken>>;
  try {
    await ensureDatabaseReady();
    snapshot = await findSnapshotByToken(token);
  } catch {
    writeHtml(res, 503, renderLenderErrorPage('unavailable'));
    return;
  }
  if (!snapshot) {
    writeHtml(res, 404, renderLenderErrorPage('not-found'));
    return;
  }
  if (snapshot.status === 'withdrawn') {
    writeHtml(res, 410, renderLenderErrorPage('withdrawn'));
    return;
  }
  const parsed = JSON.parse(snapshot.json.toString('utf8')) as Snapshot;
  writeHtml(res, 200, renderLenderPage(parsed, token));
}

const staffPagePatterns = [/^\/$/, /^\/records$/, /^\/records\/[^/]+$/];

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? '/', 'http://hangline.local');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (path === '/api' || path.startsWith('/api/')) {
        await handleApi(req, res, path, url.searchParams);
        return;
      }
      if (path === '/p' || path.startsWith('/p/')) {
        if (method !== 'GET') {
          req.resume();
          writeApiError(res, errors.readOnly());
          return;
        }
        const token = path.slice('/p/'.length);
        if (token === '' || token.includes('/')) {
          writeHtml(res, 404, renderLenderErrorPage('not-found'));
          return;
        }
        await handleLenderPage(res, token);
        return;
      }
      if (method !== 'GET' && method !== 'HEAD') {
        writeNotFound(res);
        return;
      }
      if (staffPagePatterns.some((pattern) => pattern.test(path))) {
        writeHtml(res, 200, renderStaffShell());
        return;
      }
      if (serveStatic(path, res)) return;
      writeNotFound(res);
    } catch {
      if (!res.headersSent) {
        writeApiError(res, errors.databaseUnavailable());
      } else {
        res.end();
      }
    }
  })();
});

function startLoop(task: () => Promise<void>, intervalMs: number): void {
  const run = (): void => {
    void task()
      .catch(() => undefined)
      .finally(() => {
        setTimeout(run, intervalMs).unref();
      });
  };
  setTimeout(run, intervalMs).unref();
}

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Hangline listening on port ${config.port}\n`);
  startStatusProbes();
  startLoop(publishDuePreviews, 3000);
  startLoop(deliverPendingMail, 5000);
});
