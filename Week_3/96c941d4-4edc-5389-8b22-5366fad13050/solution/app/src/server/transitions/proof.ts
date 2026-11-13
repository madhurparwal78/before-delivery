import type { TransitionRow } from '../transitions.js';

export type ProofState = 'pending' | 'verifying' | 'qualified' | 'failed' | 'obsolete';

export const PROOF_TRANSITIONS: TransitionRow[] = [
  { source: 'absent', actorAction: 'Owner issues playtest ticket', destinationCondition: 'pending' },
  { source: 'pending', actorAction: 'System begins verification', destinationCondition: 'verifying' },
  { source: 'verifying', actorAction: 'System returns run to submitted', destinationCondition: 'pending' },
  {
    source: 'verifying',
    actorAction: 'System accepts matching current-revision victory',
    destinationCondition: 'qualified',
  },
  { source: 'verifying', actorAction: 'System rejects or accepts defeat', destinationCondition: 'failed' },
  {
    source: 'pending, verifying or qualified',
    actorAction: 'Owner saves a new level revision',
    destinationCondition: 'obsolete',
  },
  {
    source: 'verifying',
    actorAction: 'System accepts victory after its revision becomes outdated',
    destinationCondition: 'obsolete',
  },
];

export const proofSources = {
  begin: ['pending'], resume: ['verifying'], revise: ['pending','verifying','qualified'], finish: ['verifying'],
} as const;
export function proofDestination(state: ProofState, action: keyof typeof proofSources, victory = false, matchingRevision = true): ProofState {
  if (!(proofSources[action] as readonly string[]).includes(state)) return state;
  if (action === 'revise') return 'obsolete';
  if (action === 'begin') return 'verifying';
  if (action === 'resume') return 'pending';
  return !matchingRevision ? 'obsolete' : victory ? 'qualified' : 'failed';
}
