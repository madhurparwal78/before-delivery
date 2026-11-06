import type { PlatformStatus } from '../../shared/types';
import { mailIsUp } from './mail';
import { storageIsUp } from './storage';

let cached: PlatformStatus = { storage: 'up', mail: 'up' };
let checked = false;
let running: Promise<PlatformStatus> | null = null;

async function probe(): Promise<PlatformStatus> {
  const [storage, mail] = await Promise.all([storageIsUp(), mailIsUp()]);
  cached = { storage: storage ? 'up' : 'down', mail: mail ? 'up' : 'down' };
  checked = true;
  return cached;
}

export async function platformStatus(): Promise<PlatformStatus> {
  if (checked) return cached;
  running ??= probe().finally(() => {
    running = null;
  });
  return running;
}

export function startStatusPoller(): NodeJS.Timeout {
  void platformStatus();
  const timer = setInterval(() => {
    void probe().catch(() => undefined);
  }, 5000);
  timer.unref();
  return timer;
}
