import type { ServiceStatus } from '../../shared/types';
import { billingAnswers } from './killbill';
import { mailAnswers } from './smtp';
import { bucketAnswers } from './s3';

const CACHE_MS = 5000;

let cachedAt = 0;
let cached: ServiceStatus | null = null;
let probing: Promise<ServiceStatus> | null = null;

async function probe(): Promise<ServiceStatus> {
  const [storage, billing, mail] = await Promise.all([
    bucketAnswers(),
    billingAnswers(),
    mailAnswers(),
  ]);
  return {
    storage: storage ? 'up' : 'down',
    billing: billing ? 'up' : 'down',
    mail: mail ? 'up' : 'down',
  };
}

/** Probes each service with a two-second timeout and caches the result for at most five seconds. */
export async function serviceStatus(): Promise<ServiceStatus> {
  const now = Date.now();
  if (cached !== null && now - cachedAt < CACHE_MS) return cached;
  if (probing === null) {
    probing = probe()
      .then((status) => {
        cached = status;
        cachedAt = Date.now();
        return status;
      })
      .finally(() => {
        probing = null;
      });
  }
  return probing;
}
