import {
  classify,
  classifiedCount,
  trainPerceptron,
  score,
  neighbours,
  springRegime,
  SPRING_REGIME_COPY,
  type Specimen,
  type Rule,
  type TrainingPoint,
  type HeldOut,
  type WordVector,
} from '../../shared/exhibits.ts';

/** The four live exhibits: results are computed in the browser from the seed. */

export interface SpringSeed {
  key: 'spring';
  stiffness: { min: number; max: number; step: number; initial: number };
  damping: { min: number; max: number; step: number; initial: number };
}

export interface RulesSeed {
  key: 'rules';
  specimens: Specimen[];
  rules: Rule[];
  attributes: { legs: { min: number; max: number }; wings: boolean[]; feathers: boolean[] };
  labels: string[];
  new_rule: Rule;
  max_rules: number;
}

export interface ClassifierSeed {
  key: 'classifier';
  grid: { min: number; max: number };
  max_epochs: number;
  training: TrainingPoint[];
  held_out: HeldOut[];
}

export interface NeighboursSeed {
  key: 'neighbours';
  words: WordVector[];
  contexts: string[];
}

export type ExhibitSeed = SpringSeed | RulesSeed | ClassifierSeed | NeighboursSeed;

/** Spring: the damping regime decided by the current stiffness and damping. */
export function springState(stiffness: number, damping: number): { regime: string; copy: string } {
  const regime = springRegime(stiffness, damping);
  return { regime, copy: SPRING_REGIME_COPY[regime] };
}

/** Rules: reclassify the specimens in first-match order. */
export function rulesState(seed: RulesSeed, rules: Rule[]): { labels: Map<string, string>; count: number; copy: string } {
  const labels = classify(seed.specimens, rules);
  const count = classifiedCount(seed.specimens, rules);
  return { labels, count, copy: `${count} of 12 specimens classified.` };
}

/** Classifier: train, then score on the held-out points. */
export function classifierState(training: TrainingPoint[], maxEpochs: number, heldOut: HeldOut[]): {
  model: ReturnType<typeof trainPerceptron>;
  score: ReturnType<typeof score>;
  copyAfterMove: string;
} {
  const model = trainPerceptron(training, maxEpochs);
  const s = score(model, heldOut);
  return { model, score: s, copyAfterMove: `Held-out accuracy ${s.accuracy}%.` };
}

export function classifierTrainCopy(training: TrainingPoint[], maxEpochs: number, heldOut: HeldOut[]): string {
  const model = trainPerceptron(training, maxEpochs);
  const s = score(model, heldOut);
  return `Training finished. Held-out accuracy ${s.accuracy}% after ${model.epochs} epochs.`;
}

/** Neighbours: the three nearest words by the published similarity rule. */
export function neighboursState(seed: NeighboursSeed, word: string, context: string | null): {
  rows: Array<{ word: string; similarity: string }>;
  copy: string;
} {
  const rows = neighbours(seed.words, word, context);
  const list = rows.map((r) => r.word).join(', ');
  const copy = context
    ? `Nearest to ${word} near ${context}: ${list}.`
    : `Nearest to ${word}: ${list}.`;
  return { rows, copy };
}
