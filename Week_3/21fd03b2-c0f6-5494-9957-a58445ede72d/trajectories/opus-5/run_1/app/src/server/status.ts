import type { StatusResponse } from '../shared/api.js';
import { storageReachable } from './s3.js';
import { mailReachable } from './smtp.js';
import { valkey } from './valkey.js';

const MAX_AGE_MS = 5_000;

let cached: StatusResponse = { locks: 'down', storage: 'down', mail: 'down' };
let checkedAt = 0;
let running: Promise<StatusResponse> | null = null;

async function refresh(): Promise<StatusResponse> {
  const [locks, storage, mail] = await Promise.all([
    valkey.ping(),
    storageReachable(),
    mailReachable(),
  ]);
  cached = {
    locks: locks ? 'ok' : 'down',
    storage: storage ? 'ok' : 'down',
    mail: mail ? 'ok' : 'down',
  };
  checkedAt = Date.now();
  return cached;
}

export async function serviceStatus(): Promise<StatusResponse> {
  if (Date.now() - checkedAt < MAX_AGE_MS) return cached;
  if (!running) {
    running = refresh().finally(() => {
      running = null;
    });
  }
  return running;
}

export function startStatusWatch(): void {
  const tick = (): void => {
    void serviceStatus().catch(() => undefined);
  };
  tick();
  setInterval(tick, 3_000).unref();
}
