import type { AppRole, MilestoneKey } from './seed.js';

export type CommissionState =
  | 'briefed'
  | 'previewed'
  | 'placed'
  | 'held'
  | 'contracted'
  | 'concept_approved'
  | 'fabricating'
  | 'installed'
  | 'accepted'
  | 'maintained'
  | 'cancelled';

/** How a move is made: which part of the product may perform it. */
export type TransitionChannel = 'automatic' | 'transitions' | 'hold' | 'maintenance';

export interface Transition {
  from: CommissionState;
  to: CommissionState;
  channel: TransitionChannel;
  /** Roles allowed to make the move; 'client_owner' and 'assigned_crew' are narrowed by the caller. */
  actors: readonly TransitionActor[];
  /** The milestone that must be paid before the move is allowed. */
  requiresPaidMilestone?: MilestoneKey;
}

export type TransitionActor = 'client_owner' | 'producer' | 'assigned_crew' | 'system';

const CANCELLABLE_FROM: readonly CommissionState[] = [
  'briefed', 'previewed', 'placed', 'held', 'contracted', 'concept_approved',
];

/** The published transitions. This table is the only description of legal moves. */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'briefed', to: 'previewed', channel: 'automatic', actors: ['system'] },
  { from: 'previewed', to: 'placed', channel: 'automatic', actors: ['system'] },
  { from: 'placed', to: 'held', channel: 'hold', actors: ['client_owner'] },
  { from: 'held', to: 'placed', channel: 'automatic', actors: ['system'] },
  { from: 'held', to: 'contracted', channel: 'automatic', actors: ['system'] },
  { from: 'contracted', to: 'concept_approved', channel: 'transitions', actors: ['client_owner'] },
  {
    from: 'concept_approved',
    to: 'fabricating',
    channel: 'transitions',
    actors: ['producer'],
    requiresPaidMilestone: 'concept_approval',
  },
  {
    from: 'fabricating',
    to: 'installed',
    channel: 'transitions',
    actors: ['assigned_crew', 'producer'],
    requiresPaidMilestone: 'fabrication',
  },
  { from: 'installed', to: 'accepted', channel: 'transitions', actors: ['client_owner'] },
  {
    from: 'accepted',
    to: 'maintained',
    channel: 'maintenance',
    actors: ['client_owner'],
    requiresPaidMilestone: 'signed_acceptance',
  },
  ...CANCELLABLE_FROM.map(
    (from): Transition => ({ from, to: 'cancelled', channel: 'transitions', actors: ['producer'] }),
  ),
];

export function findTransition(
  from: CommissionState,
  to: CommissionState,
  channel: TransitionChannel,
): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to && t.channel === channel);
}

/** States the transitions endpoint may be asked for. */
export const REQUESTABLE_STATES: readonly CommissionState[] = [
  'concept_approved', 'fabricating', 'installed', 'accepted', 'cancelled',
];

export function illegalTransitionMessage(from: CommissionState, to: CommissionState): string {
  return `A commission can't move from ${from} to ${to}.`;
}

/** Options may be changed only in previewed and placed, and only before a sponsor accepts. */
export const OPTIONS_EDITABLE_STATES: readonly CommissionState[] = ['previewed', 'placed'];

/** A layout may be saved in these states. */
export const LAYOUT_EDITABLE_STATES: readonly CommissionState[] = [
  'previewed', 'placed', 'held', 'contracted', 'concept_approved',
];

/** A concept preview may be requested in these states. */
export const RENDER_REQUEST_STATES: readonly CommissionState[] = ['briefed', 'previewed', 'placed'];

export const ROLE_LANDING_ROUTE: Record<AppRole, string> = {
  producer: '/studio',
  client: '/commissions',
  crew: '/crew',
  sponsor: '/commissions',
};

export const COMMISSION_STATE_LABELS: Record<CommissionState, string> = {
  briefed: 'Briefed',
  previewed: 'Previewed',
  placed: 'Placed',
  held: 'Held',
  contracted: 'Contracted',
  concept_approved: 'Concept approved',
  fabricating: 'Fabricating',
  installed: 'Installed',
  accepted: 'Accepted',
  maintained: 'Maintained',
  cancelled: 'Cancelled',
};
