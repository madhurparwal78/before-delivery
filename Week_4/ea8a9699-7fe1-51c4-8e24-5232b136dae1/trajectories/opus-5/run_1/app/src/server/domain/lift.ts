import type { ClusterStatus } from '../../shared/types.js';

export interface LiftableRow {
  status: ClusterStatus;
  lifts_at: Date | null;
  published_at: Date | null;
}

/**
 * The one place that decides when an embargo has lifted. An embargoed cluster counts as public
 * from its lift instant exactly, whether or not the promotion job has run yet.
 */
export function effectiveStatus(row: LiftableRow, now: Date): ClusterStatus {
  if (row.status === 'embargoed' && row.lifts_at !== null && row.lifts_at.getTime() <= now.getTime()) {
    return 'public';
  }
  return row.status;
}

export function effectivePublishedAt(row: LiftableRow, now: Date): Date | null {
  if (effectiveStatus(row, now) === 'public') {
    return row.published_at ?? row.lifts_at;
  }
  return row.published_at;
}

/**
 * The same rule in SQL, for listings that must agree with `effectiveStatus` on every instance.
 * `c` is the alias of the clusters table and `now()` is the shared server clock.
 */
export const publicClusterSql =
  "(c.status = 'public' or (c.status = 'embargoed' and c.lifts_at is not null and c.lifts_at <= now()))";

export const publicPublishedAtSql = 'coalesce(c.published_at, c.lifts_at)';
