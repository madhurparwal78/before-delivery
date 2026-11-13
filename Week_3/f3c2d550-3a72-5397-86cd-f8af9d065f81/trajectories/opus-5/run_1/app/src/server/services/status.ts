import type { ServiceState } from '../../shared/types.js';
import { drainSearchQueue, rebuildIndex } from '../workers/searchCatchUp.js';
import * as printing from './printing.js';
import * as search from './search.js';
import { storageReachable } from './storage.js';

/**
 * Each app copy checks the services it depends on and reports what it last found.
 * Nothing here decides a winner; it only says whether a service can be reached now.
 */

export interface Services {
  search: ServiceState;
  storage: ServiceState;
  printing: ServiceState;
}

const CHECK_INTERVAL_MS = 3_000;

let services: Services = { search: 'down', storage: 'down', printing: 'down' };
let rebuilding = false;

export function currentServices(): Services {
  return { ...services };
}

export function searchUsable(): boolean {
  return services.search === 'up';
}

export function storageUsable(): boolean {
  return services.storage === 'up';
}

export function printingUsable(): boolean {
  return services.printing === 'up';
}

async function checkSearch(): Promise<ServiceState> {
  if (!(await search.reachable())) return 'down';
  try {
    const { existed } = await search.ensureIndex();
    if (!existed) {
      rebuilding = true;
      void runRebuild();
    }
  } catch {
    return 'down';
  }
  if (rebuilding) return 'down';
  return 'up';
}

async function runRebuild(): Promise<void> {
  try {
    await rebuildIndex();
  } finally {
    rebuilding = false;
  }
}

export async function checkServices(): Promise<void> {
  const [searchState, storageState, printingState] = await Promise.all([
    checkSearch(),
    storageReachable().then((up): ServiceState => (up ? 'up' : 'down')),
    printing.reachable().then((up): ServiceState => (up ? 'up' : 'down')),
  ]);
  services = { search: searchState, storage: storageState, printing: printingState };
  if (searchState === 'up') {
    await drainSearchQueue().catch(() => undefined);
  }
}

export function startStatusChecks(): void {
  const tick = (): void => {
    void checkServices().catch(() => undefined);
  };
  setInterval(tick, CHECK_INTERVAL_MS).unref();
}
