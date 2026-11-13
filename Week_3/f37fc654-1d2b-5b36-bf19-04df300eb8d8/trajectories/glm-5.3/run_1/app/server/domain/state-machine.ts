// The one place the commission state machine lives.
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

export type TransitionTarget = 'concept_approved' | 'fabricating' | 'installed' | 'accepted' | 'cancelled';

export const COMMISSION_STATES: CommissionState[] = [
  'briefed', 'previewed', 'placed', 'held', 'contracted', 'concept_approved',
  'fabricating', 'installed', 'accepted', 'maintained', 'cancelled',
];

export const STATE_LABELS: Record<CommissionState, string> = {
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

/** Allowed transitions. `actor` is null for automatic moves. */
const AUTOMATIC: Partial<Record<CommissionState, Partial<Record<CommissionState, 'auto'>>>> = {
  briefed: { previewed: 'auto' },
  previewed: { placed: 'auto' },
  placed: { held: 'auto' },
  held: { placed: 'auto', contracted: 'auto' },
  contracted: { concept_approved: 'auto' },
  concept_approved: { fabricating: 'auto' },
  fabricating: { installed: 'auto' },
  installed: { accepted: 'auto' },
  accepted: { maintained: 'auto' },
};

/** Transitions reachable through POST /transitions, by role. */
const MANUAL: Partial<Record<CommissionState, Partial<Record<TransitionTarget, 'client_owner' | 'producer' | 'crew_or_producer'>>>> = {
  contracted: { concept_approved: 'client_owner', cancelled: 'producer' },
  concept_approved: { fabricating: 'producer', cancelled: 'producer' },
  fabricating: { installed: 'crew_or_producer' },
  installed: { accepted: 'client_owner' },
  briefed: { cancelled: 'producer' },
  previewed: { cancelled: 'producer' },
  placed: { cancelled: 'producer' },
  held: { cancelled: 'producer' },
};

export function automaticAllowed(from: CommissionState, to: CommissionState): boolean {
  return AUTOMATIC[from]?.[to] === 'auto';
}

export type ManualActor = 'client_owner' | 'producer' | 'crew_or_producer';

export function manualActor(from: CommissionState, to: TransitionTarget): ManualActor | null {
  return MANUAL[from]?.[to] ?? null;
}
