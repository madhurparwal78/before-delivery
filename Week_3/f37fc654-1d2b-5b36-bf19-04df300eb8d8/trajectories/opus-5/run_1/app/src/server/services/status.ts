import { databaseIsUp } from '../db/pool.js';
import { SERVICE_NAMES, type ServiceName } from '../../shared/copy.js';
import { billingIsUp } from './killbill.js';
import { documentsAreUp } from './gotenberg.js';
import { signInIsUp } from './keycloak.js';
import { mailIsUp } from './mail.js';
import { alertsAreUp } from './ntfy.js';
import { renderProviderIsUp } from './render-provider.js';
import { storageIsUp } from './s3.js';
import { webhooksAreUp } from './svix.js';

export type ServiceStatus = 'up' | 'down';
export type StatusReport = Record<ServiceName, ServiceStatus>;

const PROBE_TIMEOUT_MS = 3_000;
const CACHE_MS = 5_000;

const PROBES: Record<ServiceName, () => Promise<boolean>> = {
  postgres: databaseIsUp,
  keycloak: signInIsUp,
  killbill: billingIsUp,
  mailpit: mailIsUp,
  minio: storageIsUp,
  gotenberg: documentsAreUp,
  svix: webhooksAreUp,
  ntfy: alertsAreUp,
  renderProvider: renderProviderIsUp,
};

async function probe(service: ServiceName): Promise<ServiceStatus> {
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
  });
  try {
    const up = await Promise.race([PROBES[service](), timeout]);
    return up ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

let cache: { report: StatusReport; at: number } | null = null;
let inFlight: Promise<StatusReport> | null = null;

/** Each probe takes at most 3 seconds, and results are reused for at most 5 seconds. */
export async function serviceStatus(): Promise<StatusReport> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.report;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const entries = await Promise.all(
      SERVICE_NAMES.map(async (service) => [service, await probe(service)] as const),
    );
    const report = Object.fromEntries(entries) as StatusReport;
    cache = { report, at: Date.now() };
    inFlight = null;
    return report;
  })();
  return inFlight;
}

