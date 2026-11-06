import { healthy as billingHealthy } from './killbill';
import { probeBucket } from './s3';

export type DependencyState = 'up' | 'down';

interface DependencySnapshot {
  storage: DependencyState;
  billing: DependencyState;
  checkedAt: Date;
}

const snapshot: DependencySnapshot = { storage: 'up', billing: 'up', checkedAt: new Date() };

export function dependencySnapshot(): DependencySnapshot {
  return { ...snapshot };
}

export function storageIsUp(): boolean {
  return snapshot.storage === 'up';
}

export function noteStorageFailure(): void {
  snapshot.storage = 'down';
  snapshot.checkedAt = new Date();
}

export function noteBillingFailure(): void {
  snapshot.billing = 'down';
  snapshot.checkedAt = new Date();
}

async function probe(): Promise<void> {
  const [storage, billing] = await Promise.all([probeBucket(), billingHealthy()]);
  snapshot.storage = storage ? 'up' : 'down';
  snapshot.billing = billing ? 'up' : 'down';
  snapshot.checkedAt = new Date();
}

/** Checks storage and billing at least every ten seconds. */
export function startDependencyProbes(): void {
  void probe();
  setInterval(() => void probe(), 5000).unref();
}
