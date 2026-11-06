import { config } from '../config.js';
import { pool } from '../db.js';
import { isDraining } from '../http.js';
import { storageHealthy } from '../services/storage.js';
import { mailHealthy } from '../services/smtp.js';
import { billingHealthy } from '../services/killbill.js';

/**
 * Readiness reports each dependency within a bounded time and names the ones that are
 * down. Liveness needs no dependency at all and is answered in the request pipeline.
 */
type DependencyName = 'postgres' | 'minio' | 'killbill' | 'mailpit';

async function postgresHealthy(timeoutMs: number): Promise<boolean> {
  const client = await Promise.race([
    pool.connect().then((connection) => connection),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (client === null) return false;
  try {
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    client.release();
  }
}

export async function readiness(): Promise<{ status: number; body: Record<string, unknown> }> {
  const timeout = config.readyCheckTimeoutMs;
  const checks: [DependencyName, Promise<boolean>][] = [
    ['postgres', postgresHealthy(timeout)],
    ['minio', storageHealthy(timeout)],
    ['killbill', billingHealthy(timeout)],
    ['mailpit', mailHealthy(timeout)],
  ];
  const dependencies: Record<string, 'up' | 'down'> = {};
  const down: string[] = [];
  for (const [name, check] of checks) {
    const healthy = await check;
    dependencies[name] = healthy ? 'up' : 'down';
    if (!healthy) down.push(name);
  }

  if (isDraining()) {
    return { status: 503, body: { status: 'not_ready', draining: true, dependencies, down } };
  }
  if (down.length > 0) {
    return { status: 503, body: { status: 'not_ready', dependencies, down } };
  }
  return { status: 200, body: { status: 'ready', dependencies } };
}
