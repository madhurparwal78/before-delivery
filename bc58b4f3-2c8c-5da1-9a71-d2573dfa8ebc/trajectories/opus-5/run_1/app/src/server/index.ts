import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { applySchemaAndSeed } from './db/seed.js';
import { ApiError } from './http/errors.js';
import { assignmentRoutes } from './http/routes/assignments.js';
import { billingRoutes } from './http/routes/billing.js';
import { coverageRoutes } from './http/routes/coverage.js';
import { healthRoutes } from './http/routes/health.js';
import { orgRoutes } from './http/routes/org.js';
import { seatRoutes } from './http/routes/seats.js';
import { sessionRoutes } from './http/routes/session.js';
import { dispatch, type Reply, type Route } from './http/router.js';
import { serveClient } from './http/static.js';
import { postQueuedInvoices } from './services/billing.js';
import { flushOutbox } from './services/mail.js';
import { ensureBucket } from './services/storage.js';

const routes: Route[] = [
  ...healthRoutes,
  ...sessionRoutes,
  ...assignmentRoutes,
  ...seatRoutes,
  ...coverageRoutes,
  ...billingRoutes,
  ...orgRoutes,
];

const OUTBOX_INTERVAL_MS = 5000;

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...(reply.headers ?? {}),
  };
  if (reply.json !== undefined) {
    const payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = String(payload.length);
    response.writeHead(reply.status, headers);
    response.end(payload);
    return;
  }
  if (reply.body !== undefined) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    headers['Content-Length'] = String(reply.body.length);
    response.writeHead(reply.status, headers);
    response.end(reply.body);
    return;
  }
  response.writeHead(reply.status, headers);
  response.end();
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/');
  try {
    if (isApi) {
      send(response, await dispatch(routes, request, url));
      return;
    }
    if (request.method === 'GET') {
      const asset = await serveClient(url.pathname);
      if (asset !== null) {
        send(response, asset);
        return;
      }
    }
    send(response, {
      status: 404,
      json: { error: { code: 'not_found', message: 'Not found.' } },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      send(response, { status: error.status, json: error.body() });
      return;
    }
    process.stderr.write(`Unhandled request error: ${String(error)}\n`);
    send(response, {
      status: 500,
      json: { error: { code: 'internal', message: 'Something went wrong.' } },
    });
  }
}

function runRepeatedly(task: () => Promise<void>, everyMs: number): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void task()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, everyMs).unref();
}

async function startDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await applySchemaAndSeed();
      return;
    } catch (error) {
      if (attempt >= 30) throw error;
      process.stderr.write(`Waiting for Postgres (${String(error)})\n`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main(): Promise<void> {
  await startDatabase();
  await ensureBucket().catch(() => undefined);

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Teamseat listening on ${config.port}\n`);
  });

  runRepeatedly(flushOutbox, OUTBOX_INTERVAL_MS);
  runRepeatedly(postQueuedInvoices, config.billingRetrySeconds * 1000);
}

void main();
