export interface TransitionRow {
  source: string;
  actorAction: string;
  destinationCondition: string;
}

export { RUN_TRANSITIONS, runSources, runDestination } from './transitions/run.js';
export type { RunState } from './transitions/run.js';
export { CHALLENGE_TRANSITIONS, challengeSources, challengeDestination } from './transitions/challenge.js';
export type { LevelState } from './transitions/challenge.js';
export { PROOF_TRANSITIONS, proofSources, proofDestination } from './transitions/proof.js';
export type { ProofState } from './transitions/proof.js';
