import { broadcast } from '../api/events.js';
import { sweep } from '../api/sweep.js';
import { storageStatus, probeStorage } from './storage.js';
import { directoryStatus, probeDirectory } from './directory.js';

const PROBE_INTERVAL_MS = 5000;

export function startProbes(): void {
  let lastStorage: 'up' | 'down' = storageStatus();
  let lastDirectory: 'up' | 'down' = directoryStatus();
  const probe = async (): Promise<void> => {
    const st = await probeStorage();
    const dir = await probeDirectory();
    if (st !== lastStorage) {
      lastStorage = st;
      broadcast({ type: 'status', data: { storage: st, directory: dir } });
    }
    if (dir !== lastDirectory) {
      lastDirectory = dir;
      broadcast({ type: 'status', data: { storage: st, directory: dir } });
    }
  };
  setInterval(() => { void probe(); }, PROBE_INTERVAL_MS);
}

export function startSweep(): void {
  setInterval(() => { void sweep(); }, SWEEP_INTERVAL_MS);
}
const SWEEP_INTERVAL_MS = 2000;
