import { formatInstant } from '../domain/time.js';
import { headBucket } from './object-store.js';

type ArchiveStatus = { archive: 'reachable' | 'unreachable'; checked_at_utc: string };

const CHECK_INTERVAL_MS = 5000;

let lastStatus: ArchiveStatus = {
  archive: 'unreachable',
  checked_at_utc: formatInstant(Date.now()),
};

async function checkArchive(): Promise<ArchiveStatus> {
  let reachable = false;
  try {
    reachable = await headBucket();
  } catch {
    reachable = false;
  }
  lastStatus = {
    archive: reachable ? 'reachable' : 'unreachable',
    checked_at_utc: formatInstant(Date.now()),
  };
  return lastStatus;
}

export function archiveStatus(): ArchiveStatus {
  return lastStatus;
}

export function startArchiveWatch(onCheck: (status: ArchiveStatus) => Promise<void>): void {
  const run = (): void => {
    void checkArchive().then(async (status) => {
      await onCheck(status);
    });
  };
  run();
  setInterval(run, CHECK_INTERVAL_MS).unref();
}
