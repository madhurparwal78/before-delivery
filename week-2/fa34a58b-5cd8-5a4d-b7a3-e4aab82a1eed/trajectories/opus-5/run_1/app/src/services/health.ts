import { isMailUp } from './mail';
import { isStorageUp } from './storage';

const CHECK_INTERVAL_MS = 5000;

let storage: 'up' | 'down' = 'down';
let mail: 'up' | 'down' = 'down';
const listeners: (() => void)[] = [];

export function serviceHealth(): { storage: 'up' | 'down'; mail: 'up' | 'down' } {
  return { storage, mail };
}

export function onServiceHealthChange(listener: () => void): void {
  listeners.push(listener);
}

async function check(): Promise<void> {
  const [nextStorage, nextMail] = await Promise.all([isStorageUp(), isMailUp()]);
  const changed =
    (nextStorage ? 'up' : 'down') !== storage || (nextMail ? 'up' : 'down') !== mail;
  storage = nextStorage ? 'up' : 'down';
  mail = nextMail ? 'up' : 'down';
  if (changed) for (const listener of listeners) listener();
}

export async function startHealthChecks(): Promise<void> {
  await check();
  setInterval(() => {
    void check();
  }, CHECK_INTERVAL_MS).unref();
}
