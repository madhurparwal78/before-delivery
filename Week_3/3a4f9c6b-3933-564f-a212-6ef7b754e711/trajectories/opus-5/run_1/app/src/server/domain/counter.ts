import type { PromotionCounter, ResourceHealth, ResourceSync } from '../../shared/types.js';

export interface CountableRow {
  sync: ResourceSync;
  health: ResourceHealth;
}

/**
 * The one definition of the in-sync counter: rows of the current revision that are both
 * Synced and Healthy, against the number of its rows. Nothing else is ever counted.
 */
export function inSyncCounter(rows: readonly CountableRow[]): PromotionCounter {
  return {
    in_sync: rows.filter((row) => row.sync === 'Synced' && row.health === 'Healthy').length,
    total: rows.length,
  };
}
