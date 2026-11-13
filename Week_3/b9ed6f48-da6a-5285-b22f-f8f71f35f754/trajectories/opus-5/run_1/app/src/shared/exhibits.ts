export const EXHIBIT_KEYS = ['spring', 'rules', 'classifier', 'neighbours'] as const;
export type ExhibitKey = (typeof EXHIBIT_KEYS)[number];

export function isExhibitKey(value: unknown): value is ExhibitKey {
  return typeof value === 'string' && (EXHIBIT_KEYS as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------- spring */

export interface SpringSeed {
  key: 'spring';
  stiffness: { min: number; max: number; step: number; initial: number };
  damping: { min: number; max: number; step: number; initial: number };
}

export const SPRING_SEED: SpringSeed = {
  key: 'spring',
  stiffness: { min: 50, max: 300, step: 10, initial: 170 },
  damping: { min: 2, max: 40, step: 1, initial: 26 },
};

export type SpringRegime = 'underdamped' | 'critically damped' | 'overdamped';

export function springRegime(stiffness: number, damping: number): SpringRegime {
  const discriminant = damping * damping - 4 * stiffness;
  if (discriminant < 0) return 'underdamped';
  if (discriminant === 0) return 'critically damped';
  return 'overdamped';
}

/* ----------------------------------------------------------------- rules */

export type RuleAttribute = 'legs' | 'wings' | 'feathers';
export type RuleLabel = 'Bird' | 'Insect' | 'Arachnid' | 'Mammal';

export interface Specimen {
  name: string;
  legs: number;
  wings: boolean;
  feathers: boolean;
}

export interface ClassificationRule {
  attribute: RuleAttribute;
  value: number | boolean;
  label: RuleLabel;
}

export interface RulesSeed {
  key: 'rules';
  specimens: Specimen[];
  rules: ClassificationRule[];
  attributes: { legs: { min: number; max: number }; wings: boolean[]; feathers: boolean[] };
  labels: RuleLabel[];
  new_rule: ClassificationRule;
  max_rules: number;
}

export const RULES_SEED: RulesSeed = {
  key: 'rules',
  specimens: [
    { name: 'Robin', legs: 2, wings: true, feathers: true },
    { name: 'Sparrow', legs: 2, wings: true, feathers: true },
    { name: 'Penguin', legs: 2, wings: true, feathers: true },
    { name: 'Bat', legs: 2, wings: true, feathers: false },
    { name: 'Beetle', legs: 6, wings: true, feathers: false },
    { name: 'Ant', legs: 6, wings: false, feathers: false },
    { name: 'Dragonfly', legs: 6, wings: true, feathers: false },
    { name: 'Spider', legs: 8, wings: false, feathers: false },
    { name: 'Scorpion', legs: 8, wings: false, feathers: false },
    { name: 'Cat', legs: 4, wings: false, feathers: false },
    { name: 'Whale', legs: 0, wings: false, feathers: false },
    { name: 'Ostrich', legs: 2, wings: true, feathers: true },
  ],
  rules: [
    { attribute: 'feathers', value: true, label: 'Bird' },
    { attribute: 'legs', value: 6, label: 'Insect' },
    { attribute: 'legs', value: 8, label: 'Arachnid' },
  ],
  attributes: { legs: { min: 0, max: 8 }, wings: [true, false], feathers: [true, false] },
  labels: ['Bird', 'Insect', 'Arachnid', 'Mammal'],
  new_rule: { attribute: 'legs', value: 4, label: 'Mammal' },
  max_rules: 6,
};

export const UNCLASSIFIED = 'Unclassified';

/** First-match order: the first rule whose attribute equals its value labels the specimen. */
export function classifySpecimen(specimen: Specimen, rules: ClassificationRule[]): string {
  for (const rule of rules) {
    if (specimen[rule.attribute] === rule.value) return rule.label;
  }
  return UNCLASSIFIED;
}

export function classifyAll(specimens: Specimen[], rules: ClassificationRule[]): string[] {
  return specimens.map((specimen) => classifySpecimen(specimen, rules));
}

export function classifiedCount(labels: string[]): number {
  return labels.filter((label) => label !== UNCLASSIFIED).length;
}

/* ------------------------------------------------------------ classifier */

export type PointLabel = 'signal' | 'noise';

export interface LabelledPoint {
  x: number;
  y: number;
  label: PointLabel;
}

export interface ClassifierSeed {
  key: 'classifier';
  grid: { min: number; max: number };
  max_epochs: number;
  training: LabelledPoint[];
  held_out: LabelledPoint[];
}

export const CLASSIFIER_SEED: ClassifierSeed = {
  key: 'classifier',
  grid: { min: 0, max: 10 },
  max_epochs: 20,
  training: [
    { x: 7, y: 8, label: 'signal' },
    { x: 8, y: 6, label: 'signal' },
    { x: 9, y: 9, label: 'signal' },
    { x: 6, y: 9, label: 'signal' },
    { x: 8, y: 8, label: 'signal' },
    { x: 9, y: 7, label: 'signal' },
    { x: 7, y: 6, label: 'signal' },
    { x: 6, y: 7, label: 'signal' },
    { x: 2, y: 3, label: 'noise' },
    { x: 3, y: 1, label: 'noise' },
    { x: 1, y: 2, label: 'noise' },
    { x: 4, y: 2, label: 'noise' },
    { x: 2, y: 5, label: 'noise' },
    { x: 3, y: 4, label: 'noise' },
    { x: 1, y: 4, label: 'noise' },
    { x: 5, y: 1, label: 'noise' },
  ],
  held_out: [
    { x: 8, y: 9, label: 'signal' },
    { x: 7, y: 7, label: 'signal' },
    { x: 5, y: 8, label: 'signal' },
    { x: 9, y: 5, label: 'signal' },
    { x: 2, y: 2, label: 'noise' },
    { x: 4, y: 3, label: 'noise' },
    { x: 3, y: 6, label: 'noise' },
    { x: 6, y: 4, label: 'noise' },
  ],
};

export interface PerceptronWeights {
  w1: number;
  w2: number;
  b: number;
}

export interface TrainingRun {
  weights: PerceptronWeights;
  epochs: number;
  /** The weights after each epoch, so the decision line can be drawn epoch by epoch. */
  history: PerceptronWeights[];
}

const signOf = (label: PointLabel): number => (label === 'signal' ? 1 : -1);

export function trainPerceptron(points: LabelledPoint[], maxEpochs = CLASSIFIER_SEED.max_epochs): TrainingRun {
  let w1 = 0;
  let w2 = 0;
  let b = 0;
  const history: PerceptronWeights[] = [];
  let epochs = 0;
  for (let epoch = 0; epoch < maxEpochs; epoch += 1) {
    epochs += 1;
    let updated = false;
    for (const point of points) {
      const label = signOf(point.label);
      if (label * (w1 * point.x + w2 * point.y + b) <= 0) {
        w1 += label * point.x;
        w2 += label * point.y;
        b += label;
        updated = true;
      }
    }
    history.push({ w1, w2, b });
    if (!updated) break;
  }
  return { weights: { w1, w2, b }, epochs, history };
}

export function predict(weights: PerceptronWeights, point: { x: number; y: number }): PointLabel {
  return weights.w1 * point.x + weights.w2 * point.y + weights.b > 0 ? 'signal' : 'noise';
}

export interface ClassifierScore {
  accuracy: number;
  truePositive: number;
  falseNegative: number;
  falsePositive: number;
  trueNegative: number;
}

/** Scored on the held-out points only: correct ÷ 8 × 100, to one decimal. */
export function scoreClassifier(weights: PerceptronWeights, heldOut: LabelledPoint[]): ClassifierScore {
  let truePositive = 0;
  let falseNegative = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  for (const point of heldOut) {
    const predicted = predict(weights, point);
    if (point.label === 'signal') {
      if (predicted === 'signal') truePositive += 1;
      else falseNegative += 1;
    } else if (predicted === 'signal') falsePositive += 1;
    else trueNegative += 1;
  }
  const correct = truePositive + trueNegative;
  return {
    accuracy: Math.round(((correct / heldOut.length) * 100 + Number.EPSILON) * 10) / 10,
    truePositive,
    falseNegative,
    falsePositive,
    trueNegative,
  };
}

export function formatAccuracy(accuracy: number): string {
  return accuracy.toFixed(1);
}

/* ------------------------------------------------------------ neighbours */

export interface WordVector {
  word: string;
  vector: number[];
}

export interface NeighboursSeed {
  key: 'neighbours';
  words: WordVector[];
  contexts: string[];
}

export const NEIGHBOURS_SEED: NeighboursSeed = {
  key: 'neighbours',
  words: [
    { word: 'bank', vector: [2, 2, 0] },
    { word: 'river', vector: [0, 4, 1] },
    { word: 'shore', vector: [0, 3, 2] },
    { word: 'water', vector: [1, 4, 0] },
    { word: 'money', vector: [4, 0, 1] },
    { word: 'loan', vector: [4, 1, 0] },
    { word: 'vault', vector: [3, 0, 2] },
    { word: 'engine', vector: [0, 0, 5] },
    { word: 'gear', vector: [1, 0, 4] },
    { word: 'memory', vector: [2, 1, 3] },
  ],
  contexts: ['river', 'money', 'engine'],
};

export interface Neighbour {
  word: string;
  similarity: number;
}

function dot(a: number[], b: number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += (a[i] ?? 0) * (b[i] ?? 0);
  return total;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function roundHalfUp2(value: number): number {
  return Math.floor(value * 100 + 0.5) / 100;
}

/** Top three candidates by cosine similarity, highest first, ties broken alphabetically. */
export function nearestNeighbours(seed: NeighboursSeed, word: string, context: string | null): Neighbour[] {
  const byWord = new Map(seed.words.map((entry) => [entry.word, entry.vector]));
  const base = byWord.get(word);
  if (!base) return [];
  const contextVector = context ? byWord.get(context) : undefined;
  const query = contextVector ? base.map((value, i) => value + (contextVector[i] ?? 0)) : [...base];
  const queryNorm = norm(query);
  const scored = seed.words
    .filter((entry) => entry.word !== word && entry.word !== context)
    .map((entry) => ({
      word: entry.word,
      similarity: roundHalfUp2(dot(query, entry.vector) / (queryNorm * norm(entry.vector))),
      raw: dot(query, entry.vector) / (queryNorm * norm(entry.vector)),
    }));
  scored.sort((a, b) => (b.raw !== a.raw ? b.raw - a.raw : a.word.localeCompare(b.word)));
  return scored.slice(0, 3).map(({ word: name, similarity }) => ({ word: name, similarity }));
}

export function formatSimilarity(similarity: number): string {
  return similarity.toFixed(2);
}

export const EXHIBIT_SEEDS = {
  spring: SPRING_SEED,
  rules: RULES_SEED,
  classifier: CLASSIFIER_SEED,
  neighbours: NEIGHBOURS_SEED,
} as const;
