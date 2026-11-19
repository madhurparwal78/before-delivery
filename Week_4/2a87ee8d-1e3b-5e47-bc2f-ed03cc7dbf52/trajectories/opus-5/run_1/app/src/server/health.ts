import { config } from './config.js';
import { databaseIsUp } from './db/pool.js';
import { storageIsUp } from './services/s3.js';
import { mailIsUp } from './services/smtp.js';
import { billingIsUp } from './services/killbill.js';

export type ProviderState = 'up' | 'down';

export interface HealthReport {
  readonly status: 'ok';
  readonly instance: string;
  readonly db: ProviderState;
  readonly killbill: ProviderState;
  readonly minio: ProviderState;
  readonly mailpit: ProviderState;
}

const CHECK_INTERVAL_MS = 5_000;

let latest: HealthReport = {
  status: 'ok',
  instance: config.instanceId,
  db: 'down',
  killbill: 'down',
  minio: 'down',
  mailpit: 'down',
};

function state(up: boolean): ProviderState {
  return up ? 'up' : 'down';
}

async function check(): Promise<void> {
  const [db, killbill, minio, mailpit] = await Promise.all([
    databaseIsUp(),
    billingIsUp(),
    storageIsUp(),
    mailIsUp(),
  ]);
  latest = {
    status: 'ok',
    instance: config.instanceId,
    db: state(db),
    killbill: state(killbill),
    minio: state(minio),
    mailpit: state(mailpit),
  };
}

/** Each provider state reflects a check made within the last 10 seconds. */
export async function startHealthChecks(): Promise<void> {
  await check();
  const timer = setInterval(() => {
    void check();
  }, CHECK_INTERVAL_MS);
  timer.unref();
}

export function healthReport(): HealthReport {
  return latest;
}
