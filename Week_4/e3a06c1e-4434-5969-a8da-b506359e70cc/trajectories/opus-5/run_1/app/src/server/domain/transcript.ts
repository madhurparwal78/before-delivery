import { splitWords } from '../../shared/text.js';
import type { Word } from '../../shared/types.js';

/** Words divide a span evenly: word k of n starts at start + k x span / n, floored. */
export const spreadWords = (
  tokens: readonly { text: string; confidence: number }[],
  startMs: number,
  endMs: number,
): Word[] => {
  const span = endMs - startMs;
  const total = tokens.length;
  return tokens.map((token, k) => ({
    text: token.text,
    confidence: token.confidence,
    start_ms: startMs + Math.floor((k * span) / total),
    end_ms: k === total - 1 ? endMs : startMs + Math.floor(((k + 1) * span) / total),
  }));
};

/** Reviewed words of an approved correction carry confidence 1.00. */
export const correctionWords = (text: string, startMs: number, endMs: number): Word[] => {
  const tokens = splitWords(text).map((word) => ({ text: word, confidence: 1 }));
  if (tokens.length === 0) return [];
  return spreadWords(tokens, startMs, endMs);
};

const edgePunctuation = /^[.,?!;:]+|[.,?!;:]+$/g;

const normaliseWord = (word: string): string => word.toLowerCase().replace(edgePunctuation, '');

/**
 * Word error rate: (substitutions + deletions + insertions) over the reviewed word
 * count, from a word-level edit distance. Null when the reviewed transcript is empty.
 */
export const wordErrorRate = (machineWords: readonly string[], reviewedWords: readonly string[]): number | null => {
  const reference = reviewedWords.map(normaliseWord);
  if (reference.length === 0) return null;
  const hypothesis = machineWords.map(normaliseWord);

  let previous = new Int32Array(reference.length + 1);
  let current = new Int32Array(reference.length + 1);
  for (let j = 0; j <= reference.length; j += 1) previous[j] = j;
  for (let i = 1; i <= hypothesis.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= reference.length; j += 1) {
      const cost = hypothesis[i - 1] === reference[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  const distance = previous[reference.length] as number;
  return Math.round((distance / reference.length) * 10000) / 10000;
};
