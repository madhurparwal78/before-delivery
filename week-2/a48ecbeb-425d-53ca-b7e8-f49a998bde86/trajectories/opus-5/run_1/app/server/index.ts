import http from 'node:http';
import { publishStockLevels, addLiveListener, startLiveFeed } from './app/live.js';
import { createSchema } from './db/schema.js';
import { seedAccounts, seedStore } from './db/seed.js';
import { readSession } from './db/sessions.js';
import { env } from './env.js';
import { ApiError, crossOrigin, notFound } from './http/errors.js';
import { ApiRouter, originAllowed, sendReply, type Reply } from './http/router.js';
import { isForbiddenPath, looksLikeAFile, serveAppShell, serveStatic } from './http/static.js';
import { startScheduler } from './jobs/scheduler.js';
import { accountRoutes } from './routes/accounts.js';
import { orderRoutes } from './routes/orders.js';
import { ownerRoutes } from './routes/owner.js';
import { shopRoutes } from './routes/shop.js';
import { staffRoutes } from './routes/staff.js';
import { stockistRoutes } from './routes/stockists.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { ensureCatalogue } from './services/killbill.js';
import { probeAllServices, startHealthProbes } from './services/health.js';

const router = new ApiRouter(
  [
    ...accountRoutes,
    ...shopRoutes,
    ...orderRoutes,
    ...subscriptionRoutes,
    ...stockistRoutes,
    ...staffRoutes,
    ...ownerRoutes,
  ],
  { loadUser: readSession },
);

function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) return { status: error.status, json: error.body() };
  console.error('unhandled request failure', error);
  return {
    status: 500,
    json: { error: 'server_error', message: 'Something went wrong on our side.' },
  };
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch(() => {
    if (!res.headersSent) sendReply(res, errorReply(null));
    else res.end();
  });
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const path = url.pathname;

  if (path === '/api/health') {
    sendReply(res, { status: 200, json: { status: 'ok' } });
    return;
  }

  if (path === '/api/live') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': open\n\n');
    addLiveListener(res);
    return;
  }

  if (path.startsWith('/api/')) {
    try {
      sendReply(res, await router.dispatch(req, path, url.searchParams));
    } catch (error) {
      sendReply(res, errorReply(error));
    }
    return;
  }

  if (!originAllowed(req)) {
    sendReply(res, errorReply(crossOrigin()));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendReply(res, errorReply(notFound()));
    return;
  }

  if (isForbiddenPath(path)) {
    sendReply(res, errorReply(notFound()));
    return;
  }

  const file = await serveStatic(path);
  if (file !== null) {
    sendReply(res, {
      status: 200,
      body: file.body,
      contentType: file.contentType,
      headers: file.immutable
        ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
        : { 'Cache-Control': 'no-cache' },
    });
    return;
  }

  if (looksLikeAFile(path)) {
    sendReply(res, errorReply(notFound()));
    return;
  }

  const shell = await serveAppShell();
  if (shell === null) {
    sendReply(res, errorReply(notFound()));
    return;
  }
  sendReply(res, {
    status: 200,
    body: shell.body,
    contentType: shell.contentType,
    headers: { 'Cache-Control': 'no-cache' },
  });
}

/** Startup work that needs a service: it retries in the background until it lands. */
async function prepareServices(): Promise<void> {
  const steps: Array<{ name: string; run: () => Promise<void> }> = [
    { name: 'schema', run: createSchema },
    { name: 'store seed', run: seedStore },
    { name: 'accounts seed', run: seedAccounts },
    { name: 'catalogue', run: ensureCatalogue },
    { name: 'stock levels', run: publishStockLevels },
  ];
  const outstanding = [...steps];
  const attempt = async (): Promise<void> => {
    for (const step of [...outstanding]) {
      try {
        await step.run();
        outstanding.splice(outstanding.indexOf(step), 1);
      } catch {
        return;
      }
    }
  };
  await attempt();
  if (outstanding.length === 0) return;
  const timer = setInterval(() => {
    if (outstanding.length === 0) {
      clearInterval(timer);
      return;
    }
    void attempt();
  }, 5_000);
  timer.unref();
}

server.listen(env.app.port, '0.0.0.0', () => {
  void probeAllServices();
  startHealthProbes();
  startLiveFeed();
  void prepareServices().then(startScheduler);
});
