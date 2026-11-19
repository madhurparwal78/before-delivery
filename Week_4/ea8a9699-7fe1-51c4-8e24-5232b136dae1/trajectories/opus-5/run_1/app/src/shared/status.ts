import type { ClusterStatus } from './types.js';

/** The one place that holds the cluster lifecycle. */
const legalEdges: ReadonlyArray<readonly [ClusterStatus, ClusterStatus]> = [
  ['draft', 'in_review'],
  ['in_review', 'draft'],
  ['in_review', 'embargoed'],
  ['embargoed', 'in_review'],
  ['embargoed', 'public'],
  ['public', 'withdrawn'],
];


export function isLegalEdge(from: ClusterStatus, to: ClusterStatus): boolean {
  return legalEdges.some(([edgeFrom, edgeTo]) => edgeFrom === from && edgeTo === to);
}

export function isLocked(status: ClusterStatus): boolean {
  return status === 'embargoed' || status === 'public' || status === 'withdrawn';
}

export function statusLabel(status: ClusterStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'in_review':
      return 'In review';
    case 'embargoed':
      return 'Embargoed';
    case 'public':
      return 'Public';
    case 'withdrawn':
      return 'Withdrawn';
  }
}
