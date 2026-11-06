/** Whether billing and document storage are reachable right now. */
import { billingReachable } from './killbill.js';
import { storageReachable } from './storage.js';

export type ServiceState = 'up' | 'down';

type Probe = { atMs: number; billing: ServiceState; storage: ServiceState };

let probe: Probe = { atMs: 0, billing: 'up', storage: 'up' };
let inFlight: Promise<Probe> | null = null;

const freshnessMs = 1000;

export async function serviceStates(): Promise<{ billing: ServiceState; storage: ServiceState }> {
  if (Date.now() - probe.atMs < freshnessMs) {
    return { billing: probe.billing, storage: probe.storage };
  }
  if (!inFlight) {
    inFlight = (async () => {
      const [billing, storage] = await Promise.all([billingReachable(), storageReachable()]);
      probe = {
        atMs: Date.now(),
        billing: billing ? 'up' : 'down',
        storage: storage ? 'up' : 'down',
      };
      inFlight = null;
      return probe;
    })();
  }
  const settled = await inFlight;
  return { billing: settled.billing, storage: settled.storage };
}

export function noteBillingDown(): void {
  probe = { ...probe, atMs: Date.now(), billing: 'down' };
}

export function noteStorageDown(): void {
  probe = { ...probe, atMs: Date.now(), storage: 'down' };
}
