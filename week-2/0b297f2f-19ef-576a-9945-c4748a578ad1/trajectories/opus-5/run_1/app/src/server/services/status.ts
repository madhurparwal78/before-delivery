import type { ServiceState, StatusResponse } from '../../shared/types';
import { probeDatabase } from '../db/pool';
import { ensureDatabaseReady, markDatabaseNotReady } from '../db/seed';
import { probeImageStore } from './imageStore';
import { probeMailRelay } from './mail';

const PROBE_INTERVAL_MS = 3000;

let state: StatusResponse = {
  services: { database: 'down', imageStore: 'down', mailRelay: 'down' },
  checkedAt: new Date().toISOString(),
};

export function getStatus(): StatusResponse {
  return state;
}

export function databaseReadsUp(): boolean {
  return state.services.database === 'up';
}

export function imageStoreReadsUp(): boolean {
  return state.services.imageStore === 'up';
}

export function mailRelayReadsUp(): boolean {
  return state.services.mailRelay === 'up';
}

async function probeOnce(): Promise<void> {
  const [database, imageStore, mailRelay] = await Promise.all([
    probeDatabase(),
    probeImageStore(),
    probeMailRelay(),
  ]);
  if (database) {
    try {
      await ensureDatabaseReady();
    } catch {
      markDatabaseNotReady();
    }
  } else {
    markDatabaseNotReady();
  }
  const read = (up: boolean): ServiceState => (up ? 'up' : 'down');
  state = {
    services: {
      database: read(database),
      imageStore: read(imageStore),
      mailRelay: read(mailRelay),
    },
    checkedAt: new Date().toISOString(),
  };
}

export function startStatusProbes(): void {
  const run = (): void => {
    void probeOnce().finally(() => {
      setTimeout(run, PROBE_INTERVAL_MS).unref();
    });
  };
  run();
}
