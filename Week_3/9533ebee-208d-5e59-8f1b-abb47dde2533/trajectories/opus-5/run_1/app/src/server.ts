/**
 * The server. It serves the built browser app and `/api` from a single origin,
 * sends no cross-origin allowance headers, and answers every error through the
 * one problem-details builder.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { config } from './config.ts';
import { applySchemaAndSeed } from './db/migrate.ts';
import { query } from './db/pool.ts';
import {
  checkMediaType,
  checkOrigin,
  originOf,
  parseJsonObject,
  readBody,
} from './http/boundary.ts';
import { internalError, isProblem, notFound, type Problem } from './http/problem.ts';
import { Router, type Reply } from './http/router.ts';
import { looksLikeFile, StaticFiles } from './http/static.ts';
import { memberRoutes } from './api/members.ts';
import { poolRoutes } from './api/pools.ts';
import { priceRoutes } from './api/prices.ts';
import { swapRoutes } from './api/swaps.ts';
import { positionRoutes } from './api/positions.ts';
import { liquidationRoutes } from './api/liquidations.ts';
import { settlementRoutes } from './api/settlements.ts';
import { ledgerRoutes } from './api/ledger.ts';
import { startBackgroundJobs } from './jobs/runner.ts';
import { startOraclePolling } from './services/oracle-poll.ts';
import { ensureBucket } from './services/s3.ts';

const router = new Router([
  ...memberRoutes,
  ...poolRoutes,
  ...priceRoutes,
  ...swapRoutes,
  ...positionRoutes,
  ...liquidationRoutes,
  ...settlementRoutes,
  ...ledgerRoutes,
]);

/** Flips once Postgres is reachable and the schema is applied. */
let ready = false;

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
  contentType = 'application/json',
): void {
  const payload = Buffer.from(JSON.stringify(body ?? null), 'utf8');
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': payload.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

function writeProblem(response: ServerResponse, problem: Problem): void {
  // A body we stopped reading leaves unread bytes on the socket, so the
  // connection closes once the refusal is written.
  const headers =
    problem.code === 'payload_too_large'
      ? { ...problem.headers, connection: 'close' }
      : problem.headers;
  writeJson(response, problem.status, problem.body(), headers, 'application/problem+json');
}

function writeText(
  response: ServerResponse,
  status: number,
  text: string,
  headers: Readonly<Record<string, string>>,
): void {
  const payload = Buffer.from(text, 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': payload.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

function writeReply(response: ServerResponse, reply: Reply): void {
  if (reply.bodyText !== undefined) {
    writeText(response, reply.status, reply.bodyText, reply.headers ?? {});
    return;
  }
  if (reply.raw !== undefined) {
    response.writeHead(reply.status, {
      'content-type': reply.raw.contentType,
      'content-length': reply.raw.bytes.byteLength,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...reply.headers,
    });
    response.end(Buffer.from(reply.raw.bytes));
    return;
  }
  writeJson(response, reply.status, reply.body ?? null, reply.headers);
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  search: URLSearchParams,
): Promise<void> {
  // The health check answers before anything else, and carries no session.
  if (path === '/api/health') {
    if (!ready) {
      writeJson(response, 503, { status: 'starting' });
      return;
    }
    try {
      await query('SELECT 1');
    } catch {
      writeJson(response, 503, { status: 'starting' });
      return;
    }
    writeJson(response, 200, { status: 'ok' });
    return;
  }

  const raw = await readBody(request);
  checkOrigin(request, originOf(request));
  checkMediaType(request);
  const body = parseJsonObject(raw);

  const reply = await router.dispatch({
    method: request.method ?? 'GET',
    path,
    search,
    body,
    headers: request.headers,
    nowMs: Date.now(),
  });
  writeReply(response, reply);
}

async function start(): Promise<void> {
  const staticRoot = join(import.meta.dirname, 'public');
  const files = await StaticFiles.load(staticRoot);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://quillmoor.invalid');
    const path = url.pathname;

    const run = async (): Promise<void> => {
      if (path === '/api' || path.startsWith('/api/')) {
        await handleApi(request, response, path, url.searchParams);
        return;
      }

      // Everything outside /api is the browser app.
      const asset = files.get(path === '/' ? '/index.html' : path);
      if (asset !== null) {
        response.writeHead(200, {
          'content-type': asset.contentType,
          'content-length': asset.bytes.byteLength,
          'cache-control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
          'x-content-type-options': 'nosniff',
        });
        response.end(asset.bytes);
        return;
      }
      // A path with a file extension that is not in the build is not a page.
      if (looksLikeFile(path)) throw notFound();

      const index = files.indexDocument();
      if (index === null) throw notFound();
      response.writeHead(200, {
        'content-type': index.contentType,
        'content-length': index.bytes.byteLength,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      response.end(index.bytes);
    };

    run().catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (isProblem(error)) {
        writeProblem(response, error);
        return;
      }
      process.stderr.write(
        `quillmoor: unexpected failure ${error instanceof Error ? error.stack : String(error)}\n`,
      );
      writeProblem(response, internalError());
    });
  });

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`quillmoor: listening on 0.0.0.0:${config.port}\n`);
  });

  // Postgres is retried every 2 seconds; the health check answers `starting`
  // until the schema is in place.
  const prepare = async (): Promise<void> => {
    for (;;) {
      try {
        await applySchemaAndSeed();
        ready = true;
        process.stdout.write('quillmoor: schema ready\n');
        return;
      } catch (error) {
        process.stderr.write(
          `quillmoor: waiting for Postgres (${error instanceof Error ? error.message : 'unknown'})\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  };
  await prepare();

  // The object store is retried every 10 seconds when it was down at boot.
  const prepareBucket = async (): Promise<void> => {
    try {
      await ensureBucket();
    } catch {
      setTimeout(() => void prepareBucket(), 10000).unref();
    }
  };
  void prepareBucket();

  startBackgroundJobs();
  startOraclePolling();
}

await start();
