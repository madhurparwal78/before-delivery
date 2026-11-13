import { serve } from '@hono/node-server';
import { app } from './app.js';
import { config } from './config.js';
import { connectWhenReachable } from './db.js';
import { DEMO_SET } from './demo.js';
import { loadDemoWhenFresh } from './seed.js';
import { ensureBucket } from './storage.js';

connectWhenReachable(async () => {
  await ensureBucket().catch(() => undefined);
  await loadDemoWhenFresh(DEMO_SET);
});

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`Tempoline listening on ${info.address}:${info.port}`);
});
