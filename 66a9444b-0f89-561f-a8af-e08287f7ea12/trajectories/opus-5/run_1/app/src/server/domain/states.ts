export type ProgrammeState = 'draft' | 'review' | 'scheduled' | 'published' | 'cancelled';

const PROGRAMME_STATES: readonly ProgrammeState[] = [
  'draft',
  'review',
  'scheduled',
  'published',
  'cancelled',
];

export type TransitionActor = 'curator' | 'artist' | 'system';

interface Transition {
  from: ProgrammeState;
  to: ProgrammeState;
  actors: readonly TransitionActor[];
}

/** Sessions and artwork entries share one state machine; every move outside it is refused. */
const LEGAL_TRANSITIONS: readonly Transition[] = [
  { from: 'draft', to: 'review', actors: ['curator', 'artist'] },
  { from: 'review', to: 'draft', actors: ['curator'] },
  { from: 'review', to: 'scheduled', actors: ['curator'] },
  { from: 'scheduled', to: 'review', actors: ['curator'] },
  { from: 'scheduled', to: 'published', actors: ['system'] },
  { from: 'scheduled', to: 'cancelled', actors: ['curator'] },
  { from: 'published', to: 'cancelled', actors: ['curator'] },
];

export function isProgrammeState(value: unknown): value is ProgrammeState {
  return typeof value === 'string' && (PROGRAMME_STATES as readonly string[]).includes(value);
}

export function transitionAllowed(
  from: ProgrammeState,
  to: ProgrammeState,
  actor: TransitionActor,
): boolean {
  return LEGAL_TRANSITIONS.some(
    (transition) =>
      transition.from === from && transition.to === to && transition.actors.includes(actor),
  );
}

export const PUBLIC_STATES: readonly ProgrammeState[] = ['published', 'cancelled'];

/** Sessions are editable in draft, review and scheduled. */
export function sessionEditable(state: ProgrammeState): boolean {
  return state === 'draft' || state === 'review' || state === 'scheduled';
}
