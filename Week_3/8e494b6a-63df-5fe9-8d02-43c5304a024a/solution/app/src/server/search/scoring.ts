// Relevance (Business rules E): one formula, one rounding, decided here.
const K1 = 1.2;
const B = 0.75;
const MESSAGE_BOOST = 2;

export function roundHalfAway(value: number, places = 4): number {
  const factor = 10 ** places;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor * (1 + Number.EPSILON))) / factor;
}

const idf = (n: number, df: number): number => Math.log(1 + (n - df + 0.5) / (df + 0.5));

const tfNorm = (tf: number, dl: number, avgdl: number): number => (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl) / avgdl));

const boostFor = (field: string): number => (field === "message" ? MESSAGE_BOOST : 1);

/** Numbers show up to 4 decimals with no trailing zeros. */
export const showNumber = (value: number): string => String(roundHalfAway(value, 4));

export interface ScoredPart {
  value: number;
  leaf: string;
  field: string;
  idf: number;
  tfNorm: number;
  boost: number;
}

export function scorePart(leaf: string, field: string, n: number, df: number, tf: number, dl: number, avgdl: number): ScoredPart {
  const boost = boostFor(field);
  const rawIdf = idf(n, df);
  const rawNorm = tfNorm(tf, dl, avgdl);
  return { value: roundHalfAway(rawIdf * rawNorm * boost), leaf, field, idf: roundHalfAway(rawIdf), tfNorm: roundHalfAway(rawNorm), boost };
}

export const partText = (part: ScoredPart): string =>
  `${part.leaf} in ${part.field}: ${showNumber(part.value)} = idf ${showNumber(part.idf)} x tf_norm ${showNumber(part.tfNorm)} x boost ${showNumber(part.boost)}`;

export const totalScore = (parts: ScoredPart[]): number => roundHalfAway(parts.reduce((sum, part) => sum + part.value, 0));
