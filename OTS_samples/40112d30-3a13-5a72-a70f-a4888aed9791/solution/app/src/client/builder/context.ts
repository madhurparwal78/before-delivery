import type { Store } from './store.ts';
import type { Sync } from './sync.ts';
import type { Trial } from './trial.ts';

/** What every pane of the builder works with. */
export interface Context {
  store: Store;
  sync: Sync;
  trial: Trial;
}
