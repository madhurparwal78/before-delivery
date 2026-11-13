// The four exhibits' seeds and rules (brief: Business rules › Exhibits, Seed data). The browser
// computes every result from the seed it fetches; nothing here is a table of answers.

export type ExhibitKey = "spring" | "rules" | "classifier" | "neighbours";
export const EXHIBIT_KEYS: readonly ExhibitKey[] = ["spring", "rules", "classifier", "neighbours"];

interface Range {
  min: number;
  max: number;
  step: number;
  initial: number;
}

export interface SpringSeed {
  key: "spring";
  stiffness: Range;
  damping: Range;
}

export type Attribute = "legs" | "wings" | "feathers";
export interface Specimen {
  name: string;
  legs: number;
  wings: boolean;
  feathers: boolean;
}
export interface Rule {
  attribute: Attribute;
  value: number | boolean;
  label: string;
}
export interface RulesSeed {
  key: "rules";
  specimens: Specimen[];
  rules: Rule[];
  attributes: { legs: { min: number; max: number }; wings: boolean[]; feathers: boolean[] };
  labels: string[];
  new_rule: Rule;
  max_rules: number;
}

export type PointLabel = "signal" | "noise";
export interface Point {
  x: number;
  y: number;
  label: PointLabel;
}
export interface ClassifierSeed {
  key: "classifier";
  grid: { min: number; max: number };
  max_epochs: number;
  training: Point[];
  held_out: Point[];
}

export interface NeighboursSeed {
  key: "neighbours";
  words: { word: string; vector: number[] }[];
  contexts: string[];
}

export type ExhibitSeed = SpringSeed | RulesSeed | ClassifierSeed | NeighboursSeed;

// Spring

type Regime = "underdamped" | "critically damped" | "overdamped";

export function springRegime(stiffness: number, damping: number): Regime {
  const discriminant = damping * damping - 4 * stiffness;
  if (discriminant < 0) return "underdamped";
  return discriminant === 0 ? "critically damped" : "overdamped";
}

// Rules

export const UNCLASSIFIED = "Unclassified";

/** First matching rule, top to bottom, labels each specimen. */
export function classify(specimens: Specimen[], rules: Rule[]): string[] {
  return specimens.map((specimen) => rules.find((rule) => specimen[rule.attribute] === rule.value)?.label ?? UNCLASSIFIED);
}

// Classifier

export interface Weights {
  w1: number;
  w2: number;
  b: number;
}
interface Training {
  weights: Weights;
  epochs: number;
  /** The weights after each epoch, for drawing the decision line epoch by epoch. */
  history: Weights[];
}

const sign = (label: PointLabel) => (label === "signal" ? 1 : -1);

/** The published perceptron: seed order, w = b = 0, stop after a clean epoch or `maxEpochs`. */
export function trainPerceptron(points: Point[], maxEpochs: number): Training {
  let w1 = 0;
  let w2 = 0;
  let b = 0;
  const history: Weights[] = [];
  for (let epoch = 1; epoch <= maxEpochs; epoch++) {
    let updates = 0;
    for (const p of points) {
      const t = sign(p.label);
      if (t * (w1 * p.x + w2 * p.y + b) <= 0) {
        w1 += t * p.x;
        w2 += t * p.y;
        b += t;
        updates++;
      }
    }
    history.push({ w1, w2, b });
    if (updates === 0) break;
  }
  return { weights: { w1, w2, b }, epochs: history.length, history };
}

function predictsSignal(weights: Weights, p: { x: number; y: number }): boolean {
  return weights.w1 * p.x + weights.w2 * p.y + weights.b > 0;
}

interface Score {
  /** Accuracy in tenths of a percent (875 = 87.5%). */
  accuracyTenths: number;
  confusion: { signal: [number, number]; noise: [number, number] };
}

export function scoreHeldOut(weights: Weights, heldOut: Point[]): Score {
  const confusion: Score["confusion"] = { signal: [0, 0], noise: [0, 0] };
  let correct = 0;
  for (const p of heldOut) {
    const predicted = predictsSignal(weights, p);
    confusion[p.label][predicted ? 0 : 1]++;
    if (predicted === (p.label === "signal")) correct++;
  }
  // correct ÷ n × 100, to one decimal, rounding halves up, in integers.
  const accuracyTenths = Math.floor((2000 * correct + heldOut.length) / (2 * heldOut.length));
  return { accuracyTenths, confusion };
}

export function formatAccuracy(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

// Neighbours

const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);

/** Compares p/√P with q/√Q exactly (P, Q > 0, integers). */
function compareRatios(p: number, bigP: number, q: number, bigQ: number): number {
  if (Math.sign(p) !== Math.sign(q)) return Math.sign(p) - Math.sign(q);
  const left = p * p * bigQ;
  const right = q * q * bigP;
  return p >= 0 ? Math.sign(left - right) : Math.sign(right - left);
}

/** cos = d/√(qq·vv), rounded half up to two decimals, exactly, as text such as `0.89`. */
function similarityText(d: number, qq: number, vv: number): string {
  const product = qq * vv;
  let hundredths = Math.round((100 * d) / Math.sqrt(product));
  // cos ≥ (2h − 1)/200 must hold and cos < (2h + 1)/200 must hold; nudge h until both do.
  while (compareRatios(200 * d, product, 2 * hundredths - 1, 1) < 0) hundredths--;
  while (compareRatios(200 * d, product, 2 * hundredths + 1, 1) >= 0) hundredths++;
  const negative = hundredths < 0;
  const digits = String(Math.abs(hundredths)).padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

interface Neighbour {
  word: string;
  similarity: string;
}

/** The three nearest words by cosine similarity to word (+ context), ties alphabetical. */
export function nearestWords(seed: NeighboursSeed, word: string, context: string | null): Neighbour[] {
  const vectors = new Map(seed.words.map((w) => [w.word, w.vector]));
  const base = vectors.get(word) ?? [];
  const query = context ? base.map((v, i) => v + (vectors.get(context) ?? [])[i]) : base;
  const qq = dot(query, query);
  return seed.words
    .filter((w) => w.word !== word && w.word !== context)
    .map((w) => ({ word: w.word, d: dot(query, w.vector), vv: dot(w.vector, w.vector) }))
    .sort((a, b) => compareRatios(b.d, b.vv, a.d, a.vv) || a.word.localeCompare(b.word))
    .slice(0, 3)
    .map((c) => ({ word: c.word, similarity: similarityText(c.d, qq, c.vv) }));
}
