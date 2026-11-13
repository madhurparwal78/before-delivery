import type { TransitionRow } from '../transitions.js';
import { ApiError } from '../errors.js';

export type LevelState = 'private' | 'proof-pending' | 'published' | 'withdrawn' | 'unlisted';

export const CHALLENGE_TRANSITIONS: TransitionRow[] = [
  { source: 'absent', actorAction: 'Owner saves definition', destinationCondition: 'private' },
  { source: 'private', actorAction: 'Owner saves matching revision', destinationCondition: 'private, next revision' },
  { source: 'private', actorAction: 'Owner begins qualified publication', destinationCondition: 'proof-pending' },
  { source: 'proof-pending', actorAction: 'System commits complete publication', destinationCondition: 'published' },
  {
    source: 'proof-pending',
    actorAction: 'Owner retries same publication',
    destinationCondition: 'proof-pending or system publication path',
  },
  {
    source: 'published',
    actorAction: 'Owner repeats identical publication',
    destinationCondition: 'published, stored challenge',
  },
  { source: 'private or proof-pending', actorAction: 'Owner withdraws', destinationCondition: 'withdrawn' },
  { source: 'published', actorAction: 'Owner withdraws', destinationCondition: 'unlisted' },
  { source: 'unlisted', actorAction: 'Owner repeats withdrawal', destinationCondition: 'unlisted' },
];

export const challengeSources = {
  edit: ['private'], publish: ['private'], commit: ['proof-pending'], withdraw: ['private','proof-pending','published','unlisted'],
} as const;
export function challengeDestination(state: LevelState, action: keyof typeof challengeSources): LevelState {
  if (!(challengeSources[action] as readonly string[]).includes(state)) throw new ApiError('INVALID_TRANSITION');
  if (action === 'edit') return 'private';
  if (action === 'publish') return 'proof-pending';
  if (action === 'commit') return 'published';
  return state === 'published' || state === 'unlisted' ? 'unlisted' : 'withdrawn';
}
