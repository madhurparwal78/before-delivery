import { databaseIsUp } from '../db/pool.js';
import { probeMail } from './mail.js';
import { probeStorage } from './storage.js';

const PROBE_INTERVAL_MS = 5000;

type ServiceState = { storage: boolean; mail: boolean; database: boolean };

const state: ServiceState = { storage: false, mail: false, database: false };

export async function runProbes(): Promise<void> {
  const [storage, mail, database] = await Promise.all([
    probeStorage(),
    probeMail(),
    databaseIsUp(),
  ]);
  state.storage = storage;
  state.mail = mail;
  state.database = database;
}

export function startProbeLoop(): void {
  const timer = setInterval(() => {
    void runProbes();
  }, PROBE_INTERVAL_MS);
  timer.unref();
}

export function storageIsUp(): boolean {
  return state.storage;
}

export function mailIsUp(): boolean {
  return state.mail;
}

export function databaseWasUp(): boolean {
  return state.database;
}
