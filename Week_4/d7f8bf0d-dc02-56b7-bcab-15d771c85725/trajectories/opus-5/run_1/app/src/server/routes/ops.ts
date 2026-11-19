import { errors } from '../errors.js';
import { SESSION_COOKIE } from '../services/auth.js';
import { probeGotenberg } from '../services/gotenberg.js';
import { liveInstances } from '../services/instances.js';
import { allLeases, ensureProbed } from '../services/valkey.js';
import type { Route } from '../router.js';

export interface StopRequest {
  restartAfterMs: number;
}

let stopHandler: ((request: StopRequest) => void) | null = null;

/** The instance process registers how it stops itself at the founder's request. */
export function setStopHandler(handler: (request: StopRequest) => void): void {
  stopHandler = handler;
}

export const opsRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    auth: 'open',
    handle: async () => ({ status: 200, body: { status: 'ok' } }),
  },
  {
    method: 'GET',
    path: '/api/status',
    auth: 'user',
    handle: async (ctx) => {
      const valkey = await ensureProbed(1000);
      const gotenberg = await probeGotenberg();
      return {
        status: 200,
        body: {
          valkey: valkey ? 'up' : 'down',
          gotenberg: gotenberg ? 'up' : 'down',
          instance: ctx.instanceId,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/ops/instances',
    auth: 'user',
    capability: 'found',
    handle: async () => {
      const instances = await liveInstances();
      const leases = (await ensureProbed(1000)) ? await allLeases() : new Map<string, string[]>();
      return {
        status: 200,
        body: {
          instances: instances.map((instance) => ({
            id: instance.id,
            up: instance.up,
            leases: leases.get(instance.id) ?? [],
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/ops/instances/:id/stop',
    auth: 'user',
    capability: 'found',
    handle: async (ctx) => {
      const restartAfterMs = ctx.whole('restart_after_ms', 0, 60_000);
      const target = ctx.params['id'];
      const instances = await liveInstances();
      const instance = instances.find((row) => row.id === target);
      if (!instance) throw errors.notFound();

      if (target === ctx.instanceId) {
        setTimeout(() => stopHandler?.({ restartAfterMs }), 10);
        return { status: 202, body: { instance: target } };
      }

      const cookie = ctx.req.headers.cookie ?? '';
      const response = await fetch(
        `http://127.0.0.1:${instance.port}/api/ops/instances/${target}/stop`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie.includes(SESSION_COOKIE) ? cookie : '',
          },
          body: JSON.stringify({ restart_after_ms: restartAfterMs }),
          signal: AbortSignal.timeout(3000),
        },
      ).catch(() => null);
      if (!response || !response.ok) throw errors.instancesRestarting();
      return { status: 202, body: { instance: target } };
    },
  },
];
