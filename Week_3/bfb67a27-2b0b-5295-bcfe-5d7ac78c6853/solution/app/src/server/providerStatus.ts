import { LIMITS } from './config.js';
import * as killbill from '../providers/killbill.js';
import * as storage from '../providers/storage.js';
import type { ProviderStatus } from '../shared/types.js';

interface CachedStatus {
  value: ProviderStatus;
  at: number;
}

let cached: CachedStatus | null = null;

/** Probes both providers, reusing an answer for at most the published window. */
export async function providerStatus(): Promise<ProviderStatus> {
  const now = Date.now();
  if (cached !== null && now - cached.at < LIMITS.statusCacheMs) return cached.value;
  const [payments, storageUp] = await Promise.all([
    killbill.probe(LIMITS.statusProbeTimeoutMs),
    storage.probe(LIMITS.statusProbeTimeoutMs),
  ]);
  const value: ProviderStatus = {
    payments: payments ? 'up' : 'down',
    storage: storageUp ? 'up' : 'down',
  };
  cached = { value, at: Date.now() };
  return value;
}

/** Drops the cached answer so a failed call is reflected at the next check. */
export function invalidateProviderStatus(): void {
  cached = null;
}
