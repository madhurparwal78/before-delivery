import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { applySchema } from './db/schema.js';
import { ApiError } from './http/errors.js';
import { findRoute, runRoute } from './http/router.js';
import { ownOrigin } from './http/boundary.js';
import { readAsset } from './http/static.js';
import { isClientRoute, looksLikeFileRequest } from './http/pages.js';
import { shellPage } from './http/shell.js';
import { routes } from './routes/index.js';
import { applySeed } from './seed.js';
import { connect as connectValkey } from './providers/valkey.js';
import { ensureRealmRoles } from './providers/keycloak.js';
import { ensureTenantConfiguration } from './providers/killbill.js';
import { startOutgoingWorker } from './workers/outgoing.js';
import { startSchedules } from './workers/schedules.js';
import { startTimers } from './workers/timers.js';
import type { Reply } from './http/router.js';

const STARTUP_RETRY_MS = 10_000;
const SPA_SHELL = shellPage('app');

function sendReply(response: ServerResponse, reply: Reply): void {
  if (reply.status === 0) return;
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (reply.redirect !== undefined) {
    headers.location = reply.redirect;
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  if (reply.raw !== undefined) {
    headers['content-type'] = reply.raw.contentType;
    response.writeHead(reply.status, headers);
    response.end(reply.raw.payload);
    return;
  }
  if (reply.status === 204 || reply.body === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  headers['content-type'] = 'application/json; charset=utf-8';
  response.writeHead(reply.status, headers);
  response.end(JSON.stringify(reply.body));
}

function sendError(response: ServerResponse, error: unknown, asJson: boolean): void {
  if (error instanceof ApiError) {
    if (!asJson && error.status === 404) {
      sendReply(response, {
        status: 404,
        raw: { contentType: 'text/html; charset=utf-8', payload: SPA_SHELL },
      });
      return;
    }
    sendReply(response, { status: error.status, body: error.body(), headers: error.headers });
    return;
  }
  process.stderr.write(`request failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  sendReply(response, { status: 500, body: { error: 'internal' } });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', ownOrigin(request));
  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/');

  try {
    const match = findRoute(routes, request.method ?? 'GET', url.pathname);
    if (match === 'no_method') throw new ApiError(405, 'method_not_allowed');
    if (match !== null) {
      sendReply(response, await runRoute(match, request, response, url));
      return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await readAsset(url.pathname);
      if (asset !== null) {
        sendReply(response, {
          status: 200,
          raw: { contentType: asset.contentType, payload: asset.payload },
          headers: {
            'cache-control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
          },
        });
        return;
      }
      if (!isApi && isClientRoute(url.pathname)) {
        sendReply(response, {
          status: 200,
          raw: { contentType: 'text/html; charset=utf-8', payload: SPA_SHELL },
        });
        return;
      }
    }
    throw new ApiError(404, 'not_found');
  } catch (error) {
    sendError(response, error, isApi || looksLikeFileRequest(url.pathname));
  }
}

/** Startup tasks for a provider that is unreachable are retried every 10 seconds. */
function retryUntilDone(name: string, task: () => Promise<void>): void {
  const attempt = (): void => {
    void task().catch((error: unknown) => {
      process.stderr.write(
        `startup task ${name} failed, retrying: ${error instanceof Error ? error.message : 'unknown'}\n`,
      );
      setTimeout(attempt, STARTUP_RETRY_MS).unref();
    });
  };
  attempt();
}

async function main(): Promise<void> {
  /** A provider blip must never stop the venue serving. */
  process.on('unhandledRejection', (reason: unknown) => {
    process.stderr.write(
      `unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}\n`,
    );
  });

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.listen(config.app.port, '0.0.0.0', () => {
    process.stdout.write(`plumtide venue listening on ${config.app.port}\n`);
  });

  retryUntilDone('schema', async () => {
    await applySchema(pool);
    startOutgoingWorker();
    startTimers();
    retryUntilDone('keycloak-realm', async () => {
      await ensureRealmRoles();
    });
    retryUntilDone('killbill-tenant', async () => {
      await ensureTenantConfiguration();
    });
    retryUntilDone('seed', async () => {
      await ensureTenantConfiguration();
      await applySeed();
      startSchedules();
    });
  });
  retryUntilDone('valkey', async () => {
    await connectValkey();
  });

  const shutdown = (): void => {
    server.close();
    void pool.end();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
