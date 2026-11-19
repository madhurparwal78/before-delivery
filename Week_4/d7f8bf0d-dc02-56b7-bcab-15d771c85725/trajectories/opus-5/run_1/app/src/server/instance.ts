import { createServer } from 'node:http';
import { applySchema, withSeedLock } from './db/schema.js';
import { seedIfEmpty } from './db/seed.js';
import { waitForPostgres } from './db/pool.js';
import { createHandler, type Route } from './router.js';
import { eventRoutes } from './routes/events.js';
import { identityRoutes } from './routes/identity.js';
import { layoutRoutes } from './routes/layouts.js';
import { opsRoutes, setStopHandler } from './routes/ops.js';
import { packetRoutes } from './routes/packets.js';
import { sessionRoutes } from './routes/sessions.js';
import { versionRoutes } from './routes/versions.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { heartbeat, registerInstance } from './services/instances.js';
import { startTicker } from './services/ticker.js';
import { probeGotenberg } from './services/gotenberg.js';
import { awaitValkeyReady } from './services/valkey.js';

const routes: Route[] = [
  ...opsRoutes,
  ...identityRoutes,
  ...workspaceRoutes,
  ...versionRoutes,
  ...eventRoutes,
  ...packetRoutes,
  ...sessionRoutes,
  ...layoutRoutes,
];

async function main(): Promise<void> {
  const instanceId = process.env['GANDYBOARD_INSTANCE'] ?? 'a';

  await waitForPostgres();
  await withSeedLock(async () => {
    await applySchema();
    await seedIfEmpty();
  });

  await awaitValkeyReady(3000);
  void probeGotenberg();

  const server = createServer(createHandler(routes, instanceId));
  server.keepAliveTimeout = 65_000;
  server.requestTimeout = 0;

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  await registerInstance(instanceId, port);
  setInterval(() => void heartbeat(instanceId).catch(() => undefined), 1000);
  startTicker(instanceId);

  setStopHandler(({ restartAfterMs }) => {
    process.send?.({ kind: 'stop', restartAfterMs });
    setTimeout(() => process.exit(1), 20);
  });

  process.send?.({ kind: 'ready', instanceId, port });
}

void main().catch((error: unknown) => {
  process.stderr.write(`instance failed to start: ${String(error)}\n`);
  process.exit(1);
});
