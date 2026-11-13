import { pool } from './db';
import { mailReachable } from './mail';
import { ensureBucket, storageReachable } from './storage';
import { valkeyAvailable } from './bus';

export interface ProviderStatus {
  postgres: boolean;
  minio: boolean;
  mailpit: boolean;
  valkey: boolean;
}

const status: ProviderStatus = { postgres: false, minio: false, mailpit: false, valkey: false };
let bucketReady = false;

async function probe(): Promise<void> {
  status.postgres = await pool
    .query('select 1')
    .then(() => true)
    .catch(() => false);
  status.minio = await storageReachable();
  if (status.minio && !bucketReady) {
    bucketReady = await ensureBucket()
      .then(() => true)
      .catch(() => false);
  }
  if (!status.minio) bucketReady = false;
  status.mailpit = await mailReachable();
  status.valkey = valkeyAvailable();
}

/** Each dependency is retried at least every 5 seconds so the app recovers without a restart. */
export function startHealthProbes(): void {
  void probe();
  setInterval(() => void probe(), 5000).unref();
}

export function providerStatus(): ProviderStatus {
  return { ...status, valkey: valkeyAvailable() };
}

export function allProvidersUp(): boolean {
  const current = providerStatus();
  return current.postgres && current.minio && current.mailpit && current.valkey;
}
