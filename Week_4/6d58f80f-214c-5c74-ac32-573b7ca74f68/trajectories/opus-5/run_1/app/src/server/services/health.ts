import type { ServiceStatus } from '../../shared/types.js';
import { directoryUp, probeDirectory } from './directory.js';
import { probeStorage, storageUp } from './storage.js';

export const serviceStatus = (): ServiceStatus => ({
  storage: storageUp() ? 'up' : 'down',
  directory: directoryUp() ? 'up' : 'down',
});

/** Both services are re-probed on a timer, so recovery never needs a restart. */
export const startProbes = (): void => {
  const probe = (): void => {
    void probeStorage();
    void probeDirectory();
  };
  probe();
  setInterval(probe, 5_000).unref();
};
