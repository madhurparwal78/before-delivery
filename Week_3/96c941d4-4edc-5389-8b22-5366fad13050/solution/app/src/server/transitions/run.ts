import type { TransitionRow } from '../transitions.js';
import { ApiError } from '../errors.js';

export type RunState = 'issued' | 'playing' | 'submitted' | 'verifying' | 'accepted' | 'rejected';

export const RUN_TRANSITIONS: TransitionRow[] = [
  { source: 'absent', actorAction: 'Owner issues ticket', destinationCondition: 'issued' },
  { source: 'issued', actorAction: 'Owner starts', destinationCondition: 'playing' },
  { source: 'playing', actorAction: 'Owner starts again', destinationCondition: 'playing, identical replay' },
  { source: 'playing', actorAction: 'Owner stages first submission', destinationCondition: 'submitted' },
  { source: 'submitted', actorAction: 'System confirms and reads evidence', destinationCondition: 'verifying' },
  { source: 'verifying', actorAction: 'System reproduces legal terminal play', destinationCondition: 'accepted' },
  { source: 'verifying', actorAction: 'System finds illegal or nonterminal play', destinationCondition: 'rejected' },
  {
    source: 'verifying',
    actorAction: 'System loses evidence access or resumes interrupted work',
    destinationCondition: 'submitted',
  },
  {
    source: 'submitted',
    actorAction: 'Owner retries or repeats identical evidence',
    destinationCondition: 'submitted or system verification path',
  },
  {
    source: 'accepted or rejected',
    actorAction: 'Owner repeats identical evidence or retries',
    destinationCondition: 'same state and stored result',
  },
];

export const runSources = {
  start: ['issued', 'playing'], stage: ['playing'], begin: ['submitted'], resume: ['verifying'], finish: ['verifying'],
} as const;
export function runDestination(state: RunState, action: keyof typeof runSources, accepted = false): RunState {
  if (!(runSources[action] as readonly string[]).includes(state)) throw new ApiError('INVALID_TRANSITION');
  if (action === 'start') return 'playing';
  if (action === 'stage' || action === 'resume') return 'submitted';
  if (action === 'begin') return 'verifying';
  return accepted ? 'accepted' : 'rejected';
}
