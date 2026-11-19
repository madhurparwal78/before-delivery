import { databaseReachable } from '../db';
import { storageReachable } from './storage';
import { mailReachable } from './mail';

export type ServiceStatus = 'up' | 'down';

const state: { storage: ServiceStatus; mail: ServiceStatus } = { storage: 'up', mail: 'up' };

export function noteStorage(up: boolean): void {
  state.storage = up ? 'up' : 'down';
}

export function noteMail(up: boolean): void {
  state.mail = up ? 'up' : 'down';
}

async function refresh(): Promise<void> {
  noteStorage(await storageReachable());
  noteMail(await mailReachable());
}

export function startHealthChecks(): void {
  void refresh();
  const timer = setInterval(() => void refresh(), 15_000);
  timer.unref();
}

export async function healthReport(): Promise<{
  status: 'ok';
  services: { database: ServiceStatus; storage: ServiceStatus; mail: ServiceStatus };
}> {
  const database: ServiceStatus = (await databaseReachable()) ? 'up' : 'down';
  return { status: 'ok', services: { database, storage: state.storage, mail: state.mail } };
}
