import type { Module } from './app.ts';
import { json } from './reply.ts';

/** Health, the published settings and the server time: the routes that need no account. */
export const mountPlatform: Module = (app) => {
  app.publicRoute({
    method: 'GET',
    path: '/api/health',
    beforeDatabase: true,
    handler: async () => {
      if (!app.db.ready) return json(503, { status: 'starting' });
      return json(200, { status: (await app.storage.available()) ? 'ok' : 'unavailable' });
    },
  });

  app.publicRoute({
    method: 'GET',
    path: '/api/config',
    beforeDatabase: true,
    handler: () => {
      const c = app.config;
      return json(200, {
        formula_max_chars: c.formulaMaxChars,
        formula_max_depth: c.formulaMaxDepth,
        mark_max: c.markMax,
        formula_debounce_ms: c.formulaDebounceMs,
        row_max: c.rowMax,
        csv_max_bytes: c.csvMaxBytes,
        sse_heartbeat_ms: c.sseHeartbeatMs,
      });
    },
  });

  app.publicRoute({
    method: 'GET',
    path: '/api/time',
    beforeDatabase: true,
    handler: () => json(200, { server_now: app.clock.iso() }),
  });
};
