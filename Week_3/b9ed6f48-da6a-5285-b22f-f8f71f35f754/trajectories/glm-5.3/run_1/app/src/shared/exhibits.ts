/** Exhibits: deterministic results computed from the seed. */

export interface Specimen {
  name: string;
  legs: number;
  wings: boolean;
  feathers: boolean;
}

export interface Rule {
  attribute: 'legs' | 'wings' | 'feathers';
  value: number | boolean;
  label: string;
}

/** First rule whose attribute equals its value labels the specimen. */
export function classify(specimens: Specimen[], rules: Rule[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of specimens) {
    let label = 'Unclassified';
    for (const r of rules) {
      const value = s[r.attribute];
      if (typeof r.value === 'boolean' ? value === r.value : value === r.value) {
        label = r.label;
        break;
      }
    }
    out.set(s.name, label);
  }
  return out;
}

export function classifiedCount(specimens: Specimen[], rules: Rule[]): number {
  const labels = classify(specimens, rules);
  let n = 0;
  for (const s of specimens) if (labels.get(s.name) !== 'Unclassified') n++;
  return n;
}

export interface TrainingPoint {
  x: number;
  y: number;
  label: 'signal' | 'noise';
}

export interface TrainedModel {
  w1: number;
  w2: number;
  b: number;
  epochs: number;
}

/**
 * Perceptron training on the current points in seed order.
 * Stop after the first clean epoch or 20 epochs (including that final epoch).
 */
export function trainPerceptron(points: TrainingPoint[], maxEpochs = 20): TrainedModel {
  let w1 = 0;
  let w2 = 0;
  let b = 0;
  let epochs = 0;
  for (let e = 0; e < maxEpochs; e++) {
    epochs++;
    let updates = 0;
    for (const p of points) {
      const label = p.label === 'signal' ? 1 : -1;
      if (label * (w1 * p.x + w2 * p.y + b) <= 0) {
        w1 += label * p.x;
        w2 += label * p.y;
        b += label;
        updates++;
      }
    }
    if (updates === 0) break;
  }
  return { w1, w2, b, epochs };
}

export function predict(model: TrainedModel, x: number, y: number): 'signal' | 'noise' {
  return model.w1 * x + model.w2 * y + model.b > 0 ? 'signal' : 'noise';
}

export interface HeldOut {
  x: number;
  y: number;
  label: 'signal' | 'noise';
}

export interface ClassifierScore {
  accuracy: string;
  predictedSignalSignal: number;
  predictedSignalNoise: number;
  predictedNoiseSignal: number;
  predictedNoiseNoise: number;
}

/** Score on held-out points only: correct / 8 * 100, one decimal. */
export function score(model: TrainedModel, held: HeldOut[]): ClassifierScore {
  let correct = 0;
  let ss = 0;
  let sn = 0;
  let ns = 0;
  let nn = 0;
  for (const p of held) {
    const predicted = predict(model, p.x, p.y);
    if (predicted === p.label) correct++;
    if (p.label === 'signal' && predicted === 'signal') ss++;
    else if (p.label === 'signal' && predicted === 'noise') sn++;
    else if (p.label === 'noise' && predicted === 'signal') ns++;
    else nn++;
  }
  const pct = (correct / held.length) * 100;
  return {
    accuracy: pct.toFixed(1),
    predictedSignalSignal: ss,
    predictedSignalNoise: sn,
    predictedNoiseSignal: ns,
    predictedNoiseNoise: nn,
  };
}

export interface WordVector {
  word: string;
  vector: [number, number, number];
}

function cosine(a: [number, number, number], b: [number, number, number]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const na = Math.hypot(a[0], a[1], a[2]);
  const nb = Math.hypot(b[0], b[1], b[2]);
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

/** Round half up to two decimals. */
function round2(v: number): number {
  return Math.floor(v * 100 + 0.5) / 100;
}

/**
 * Nearest words by cosine similarity of the query vector (word + context),
 * excluding the word and the context, ties broken alphabetically, top three.
 */
export function neighbours(
  words: WordVector[],
  word: string,
  context: string | null,
): Array<{ word: string; similarity: string }> {
  const wordEntry = words.find((w) => w.word === word);
  if (!wordEntry) return [];
  const contextEntry = context ? words.find((w) => w.word === context) : undefined;
  const query: [number, number, number] = contextEntry
    ? [
        wordEntry.vector[0] + contextEntry.vector[0],
        wordEntry.vector[1] + contextEntry.vector[1],
        wordEntry.vector[2] + contextEntry.vector[2],
      ]
    : wordEntry.vector;
  const ranked = words
    .filter((w) => w.word !== word && w.word !== context)
    .map((w) => ({ word: w.word, similarity: cosine(query, w.vector) }))
    .sort((a, b) => b.similarity - a.similarity || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0))
    .slice(0, 3);
  return ranked.map((r) => ({ word: r.word, similarity: round2(r.similarity).toFixed(2) }));
}

/** Spring regime: c^2 < 4k underdamped, = critically damped, > overdamped. */
export function springRegime(stiffness: number, damping: number): 'underdamped' | 'critically_damped' | 'overdamped' {
  const c2 = damping * damping;
  const fourK = 4 * stiffness;
  if (c2 < fourK) return 'underdamped';
  if (c2 === fourK) return 'critically_damped';
  return 'overdamped';
}

export const SPRING_REGIME_COPY: Record<'underdamped' | 'critically_damped' | 'overdamped', string> = {
  underdamped: 'Spring is underdamped.',
  critically_damped: 'Spring is critically damped.',
  overdamped: 'Spring is overdamped.',
};
