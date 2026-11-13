export interface TransitionRow {
  source: string;
  actorAction: string;
  destinationCondition: string;
}

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

export type RunState = 'issued' | 'playing' | 'submitted' | 'verifying' | 'accepted' | 'rejected';
export type LevelState = 'private' | 'proof-pending' | 'published' | 'withdrawn' | 'unlisted';
export type ProofState = 'pending' | 'verifying' | 'qualified' | 'failed' | 'obsolete';
