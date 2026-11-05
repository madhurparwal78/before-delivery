import { databaseUp } from '../db/pool.js';
import { storageUp } from './s3.js';
import { searchUp } from './search.js';
import { billingUp } from './killbill.js';
import { mailUp } from './mail.js';

export type ServiceName = 'database' | 'storage' | 'search' | 'billing' | 'mail';

export const SERVICE_NAMES: readonly ServiceName[] = [
  'database',
  'storage',
  'search',
  'billing',
  'mail',
];

export type ServiceState = 'up' | 'down';

export interface HealthSnapshot {
  readonly services: Readonly<Record<ServiceName, ServiceState>>;
  readonly checkedAt: string;
}

const PROBES: Readonly<Record<ServiceName, () => Promise<boolean>>> = {
  database: databaseUp,
  storage: storageUp,
  search: searchUp,
  billing: billingUp,
  mail: mailUp,
};

let snapshot: HealthSnapshot = {
  services: { database: 'up', storage: 'up', search: 'up', billing: 'up', mail: 'up' },
  checkedAt: new Date().toISOString(),
};

/** Banners follow this within ten seconds, so the poll runs twice as often. */
const POLL_MS = 5_000;

async function probeAll(): Promise<void> {
  const results = await Promise.all(SERVICE_NAMES.map(async (name) => PROBES[name]()));
  const services = {} as Record<ServiceName, ServiceState>;
  SERVICE_NAMES.forEach((name, i) => {
    services[name] = results[i] === true ? 'up' : 'down';
  });
  snapshot = { services, checkedAt: new Date().toISOString() };
}

export function currentHealth(): HealthSnapshot {
  return snapshot;
}

export function startHealthMonitor(): void {
  void probeAll();
  const timer = setInterval(() => {
    void probeAll();
  }, POLL_MS);
  timer.unref();
}
