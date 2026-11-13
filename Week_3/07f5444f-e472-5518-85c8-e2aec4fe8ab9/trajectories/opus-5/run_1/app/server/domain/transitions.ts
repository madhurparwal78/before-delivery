import type { ProgrammeStatus, RentalStatus } from '../../shared/api.js';

export const PROGRAMME_STATUS_LABELS: Record<ProgrammeStatus, string> = {
  draft: 'Draft',
  in_preparation: 'In preparation',
  published: 'Published',
  in_performance: 'In performance',
  closed: 'Closed',
};

export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
  requested: 'Requested',
  received: 'Received',
  in_use: 'In use',
  returned: 'Returned',
  checked_in: 'Checked in',
};

/** Transition requests may name every status except `published`, which only publish reaches. */
export const PROGRAMME_TRANSITION_TARGETS: readonly ProgrammeStatus[] = [
  'draft',
  'in_preparation',
  'in_performance',
  'closed',
];

const PROGRAMME_EDGES: readonly [ProgrammeStatus, ProgrammeStatus][] = [
  ['draft', 'in_preparation'],
  ['in_preparation', 'draft'],
  ['published', 'in_performance'],
  ['in_performance', 'closed'],
];

export function isLegalProgrammeEdge(from: ProgrammeStatus, to: ProgrammeStatus): boolean {
  return PROGRAMME_EDGES.some(([edgeFrom, edgeTo]) => edgeFrom === from && edgeTo === to);
}

export const RENTAL_TRANSITION_TARGETS: readonly RentalStatus[] = ['received', 'in_use', 'returned', 'checked_in'];

const RENTAL_EDGES: readonly { from: RentalStatus; to: RentalStatus; assistantMay: boolean }[] = [
  { from: 'requested', to: 'received', assistantMay: false },
  { from: 'received', to: 'in_use', assistantMay: false },
  { from: 'in_use', to: 'returned', assistantMay: true },
  { from: 'returned', to: 'checked_in', assistantMay: false },
];

export function rentalEdge(from: RentalStatus, to: RentalStatus): { assistantMay: boolean } | null {
  return RENTAL_EDGES.find((edge) => edge.from === from && edge.to === to) ?? null;
}

export function programmeAcceptsWorks(status: ProgrammeStatus): boolean {
  return status === 'draft' || status === 'in_preparation';
}
