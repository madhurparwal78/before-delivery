import net from 'node:net';
import { SERVICE_ORDER, type ServiceName } from '../../shared/copy.js';
import { env } from '../env.js';
import { probeStore } from '../db/pool.js';
import { probeKillBill } from './killbill.js';
import { probePocketBase } from './pocketbase.js';
import { probeFiles } from './files.js';

export type ServiceStatus = 'up' | 'down';

const PROBE_INTERVAL_MS = 3_000;
const PROBE_TIMEOUT_MS = 2_500;

const status: Record<ServiceName, ServiceStatus> = {
  killbill: 'down',
  postgres: 'down',
  pocketbase: 'down',
  minio: 'down',
  mailpit: 'down',
};

/** Records what a real request just learned, so an outage shows up without waiting for a probe. */
export function markService(service: ServiceName, up: boolean): void {
  status[service] = up ? 'up' : 'down';
}



export function allServiceStatuses(): Record<ServiceName, ServiceStatus> {
  return { ...status };
}


function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS),
    ),
  ]);
}

function probeMailServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: env.mail.smtpHost, port: env.mail.smtpPort });
    const finish = (error?: Error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish());
    socket.once('timeout', () => finish(new Error('smtp connect timed out')));
    socket.once('error', (error) => finish(error));
  });
}

const PROBES: Readonly<Record<ServiceName, () => Promise<unknown>>> = {
  postgres: probeStore,
  killbill: probeKillBill,
  pocketbase: probePocketBase,
  minio: probeFiles,
  mailpit: probeMailServer,
};

async function probeOnce(service: ServiceName): Promise<void> {
  try {
    await withTimeout(PROBES[service]());
    markService(service, true);
  } catch {
    markService(service, false);
  }
}

export async function probeAllServices(): Promise<void> {
  await Promise.all(SERVICE_ORDER.map(probeOnce));
}

export function startHealthProbes(): void {
  void probeAllServices();
  const timer = setInterval(() => void probeAllServices(), PROBE_INTERVAL_MS);
  timer.unref();
}
