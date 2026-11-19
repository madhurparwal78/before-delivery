import { createServer } from 'node:http';
import { config } from './config';
import { buildRouter } from './api/routes';
import { handleApi } from './http/router';
import { serveAsset, servePage } from './http/pages';
import { sendJson } from './http/respond';
import { ensureSchemaAndSeed, reconcileIdentity } from './db/boot';
import { probeDatabase } from './db/pool';
import { probeIdentity } from './services/keycloak';
import { ensureBucket } from './services/s3';
import { retryPendingStore } from './domain/issue';
import { reader } from './domain/model';

/**
 * The server starts whatever the dependencies are doing and keeps trying. A
 * failure is never cached, so everything recovers with no restart.
 */

const router = buildRouter();

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers['host'] ?? 'localhost'}`);
  if (url.pathname === '/api/health' || url.pathname.startsWith('/api/')) {
    void handleApi(router, request, response, url);
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    serveAsset(request, response, url);
    return;
  }
  void servePage(request, response, url);
});

server.on('clientError', (_error, socket) => {
  socket.destroy();
});

let databaseReady = false;
let identityReady = false;

export function dependenciesReady(): { database: boolean; identity: boolean } {
  return { database: databaseReady, identity: identityReady };
}

async function tryBoot(): Promise<void> {
  try {
    await probeDatabase();
    await ensureSchemaAndSeed();
    databaseReady = true;
  } catch {
    databaseReady = false;
    return;
  }
  try {
    await probeIdentity();
    await reconcileIdentity();
    identityReady = true;
  } catch {
    identityReady = false;
  }
}

const BOOT_INTERVAL_MS = 2000;
const IDENTITY_INTERVAL_MS = 15000;
const ISSUER_INTERVAL_MS = 5000;

async function onTick(): Promise<void> {
  if (!databaseReady || !identityReady) await tryBoot();
}

async function identityTick(): Promise<void> {
  if (!databaseReady) return;
  try {
    await reconcileIdentity();
    identityReady = true;
  } catch {
    identityReady = false;
  }
}

async function issuerTick(): Promise<void> {
  if (!databaseReady) return;
  try {
    await ensureBucket();
    await retryPendingStore(reader, new Date());
  } catch {
    // The store is not answering: Pending store drawings wait, and health stays 200.
  }
}

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`boltrope listening on ${config.port}\n`);
  void (async () => {
    await tryBoot();
    await issuerTick();
  })();
  setInterval(() => void onTick(), BOOT_INTERVAL_MS).unref();
  setInterval(() => void identityTick(), IDENTITY_INTERVAL_MS).unref();
  setInterval(() => void issuerTick(), ISSUER_INTERVAL_MS).unref();
});

process.on('unhandledRejection', (cause) => {
  process.stderr.write(`unhandled rejection: ${String(cause)}\n`);
});

export { sendJson };
