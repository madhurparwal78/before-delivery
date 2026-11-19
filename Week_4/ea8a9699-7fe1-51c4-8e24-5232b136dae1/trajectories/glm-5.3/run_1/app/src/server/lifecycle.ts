// The cluster status graph: the one place the legal edges live.

import type { ClusterStatus } from '../shared/types.js';

export const LEGAL_EDGES: ReadonlyMap<ClusterStatus, readonly ClusterStatus[]> = new Map([
  ['draft', ['in_review']],
  ['in_review', ['draft', 'embargoed']],
  ['embargoed', ['in_review']],
  ['public', ['withdrawn']],
  ['withdrawn', []],
]);

export function isLegalEdge(from: ClusterStatus, to: ClusterStatus): boolean {
  // `public` is never requested: a client request for public is always illegal.
  if (to === 'public') return false;
  return (LEGAL_EDGES.get(from) ?? []).includes(to);
}

export function lockedStatus(status: ClusterStatus): boolean {
  return status === 'embargoed' || status === 'public' || status === 'withdrawn';
}
