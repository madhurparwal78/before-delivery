import { query } from '../db.ts';
import { evidenceStore } from './storage.ts';
import { probeMailRelay } from './mailer.ts';

const PROBE_INTERVAL_MS = 5_000;

export type ServiceState = 'up' | 'down';

interface ServiceStatus {
  evidence: ServiceState;
  mail: ServiceState;
}

const status: ServiceStatus = { evidence: 'up', mail: 'up' };

/** A verify or download that fails because the store is unreachable marks evidence down at once. */
export function markEvidenceDown(): void {
  status.evidence = 'down';
}

export async function unsentNoticeCount(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*) AS count FROM notices WHERE state IN ('queued','claimed')`,
  );
  return Number(result.rows[0].count);
}

export async function currentStatus(): Promise<{
  evidence: ServiceState;
  mail: ServiceState;
  queued_notices: number;
}> {
  return { evidence: status.evidence, mail: status.mail, queued_notices: await unsentNoticeCount() };
}

export function startProbes(): void {
  const probe = async (): Promise<void> => {
    status.evidence = (await evidenceStore.probe()) ? 'up' : 'down';
    status.mail = (await probeMailRelay()) ? 'up' : 'down';
  };
  const tick = (): void => {
    probe()
      .catch(() => undefined)
      .finally(() => {
        setTimeout(tick, PROBE_INTERVAL_MS).unref();
      });
  };
  tick();
}
