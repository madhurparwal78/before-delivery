import type { ServiceStatus } from '../../shared/types.js';
import { checkIntake } from './intake.js';
import { checkStorage } from './storage.js';

const state: ServiceStatus = { intake: 'up', plot_storage: 'up' };
const listeners = new Set<(status: ServiceStatus) => void>();

export function serviceStatus(): ServiceStatus {
  return { ...state };
}

export function onServiceStatus(listener: (status: ServiceStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(service: keyof ServiceStatus, up: boolean): void {
  const next = up ? 'up' : 'down';
  if (state[service] === next) return;
  state[service] = next;
  for (const listener of listeners) listener(serviceStatus());
}

/** A failed call marks its service down at once. */
export function markIntake(up: boolean): void {
  set('intake', up);
}

export function markStorage(up: boolean): void {
  set('plot_storage', up);
}

export function startMonitor(): void {
  const run = async (): Promise<void> => {
    const [intake, storage] = await Promise.all([checkIntake(), checkStorage()]);
    set('intake', intake);
    set('plot_storage', storage);
  };
  void run();
  setInterval(() => void run(), 5000).unref();
}
