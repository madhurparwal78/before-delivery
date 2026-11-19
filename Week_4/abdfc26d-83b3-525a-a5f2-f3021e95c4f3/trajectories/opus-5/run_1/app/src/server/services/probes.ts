import type { ServiceStatus } from '../../shared/api.js';
import type { ServiceName } from '../../shared/copy.js';
import { probeProvider } from '../providers/aiRenderProvider.js';
import { probeGotenberg } from '../providers/gotenberg.js';
import { probeKillBill } from '../providers/killbill.js';
import { probeMail } from '../providers/mailer.js';
import { probeStorage } from '../providers/storage.js';

const PROBES: Readonly<Record<ServiceName, () => Promise<boolean>>> = {
  killbill: probeKillBill,
  render_provider: probeProvider,
  gotenberg: probeGotenberg,
  mail: probeMail,
  storage: probeStorage,
};

/**
 * Each instance keeps only its own latest probe results, in its own memory, so
 * the console shows the probes of the instance answering.
 */
const latest = new Map<ServiceName, ServiceStatus>();

export async function runServiceProbes(): Promise<void> {
  await Promise.all(
    (Object.keys(PROBES) as ServiceName[]).map(async (name) => {
      const reachable = await PROBES[name]().catch(() => false);
      latest.set(name, { name, reachable, checked_at: new Date().toISOString() });
    }),
  );
}

export function serviceStatuses(): ServiceStatus[] {
  return (Object.keys(PROBES) as ServiceName[]).map(
    (name) =>
      latest.get(name) ?? { name, reachable: false, checked_at: new Date(0).toISOString() },
  );
}

/** The outbox claims messages only while the latest mail probe reached mail. */
export function mailReachable(): boolean {
  return latest.get('mail')?.reachable ?? false;
}
