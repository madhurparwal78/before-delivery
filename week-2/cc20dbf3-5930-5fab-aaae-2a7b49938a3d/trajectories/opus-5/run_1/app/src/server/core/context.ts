import type { Config } from '../config.js';
import type { Database } from '../db/pool.js';
import type { Billing } from '../services/billing.js';
import type { ObjectStore } from '../services/objectStore.js';
import type { LibrarySettings } from './library.js';
import type { ServiceProbes } from './probes.js';

export interface AppContext {
  readonly config: Config;
  readonly pool: Database;
  readonly secret: Buffer;
  readonly library: LibrarySettings;
  readonly billing: Billing;
  readonly objectStore: ObjectStore;
  readonly probes: ServiceProbes;
}
