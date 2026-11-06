import { postgresReachable } from './db.ts';
import { storage } from './s3.ts';

type Availability = { sync: boolean; storage: boolean; checkedAt: number };

const state: Availability = { sync: false, storage: false, checkedAt: 0 };
let probing: Promise<void> | null = null;

async function probe(): Promise<void> {
  const [sync, store] = await Promise.all([postgresReachable(), storage.reachable()]);
  state.sync = sync;
  state.storage = store;
  state.checkedAt = Date.now();
}

function availability(): { sync: boolean; storage: boolean } {
  return { sync: state.sync, storage: state.storage };
}

/** Answers from the last probe, waiting only when nothing has been checked yet. */
export async function freshAvailability(): Promise<{ sync: boolean; storage: boolean }> {
  if (state.checkedAt === 0) {
    await Promise.race([startProbe(), new Promise((resolve) => setTimeout(resolve, 1500))]);
  }
  return availability();
}

function startProbe(): Promise<void> {
  if (!probing) {
    probing = probe().finally(() => {
      probing = null;
    });
  }
  return probing;
}

export function watchDependencies(): void {
  void startProbe();
  setInterval(() => void startProbe(), 5000).unref();
}
