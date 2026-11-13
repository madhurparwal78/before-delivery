import type { PlayerQuestion, Reveal } from '../../shared/protocol';
import { OPTION_LETTERS, copy, sharePercent } from '../lib/copy';

export interface SplitItem {
  text: string;
  count: number;
  correct: boolean;
  share: number;
}

/** The answer-split rows, identical in 3D and still modes apart from the share. */
export function splitItems(
  reveal: Reveal,
  question: PlayerQuestion | null,
  options: { withShare: boolean; marked: boolean },
): SplitItem[] {
  const rows = baseRows(reveal, question);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows.map((row) => {
    const share = sharePercent(row.count, total);
    let text = row.text;
    if (options.withShare) text += ` (${share}%)`;
    if (row.correct && options.marked) text += copy.correctAnswerSuffix;
    return { text, count: row.count, correct: row.correct, share };
  });
}

function baseRows(
  reveal: Reveal,
  question: PlayerQuestion | null,
): { text: string; count: number; correct: boolean }[] {
  if (reveal.type === 'multiple_choice') {
    const labels = question && question.type === 'multiple_choice' ? question.options : [];
    return reveal.counts.map((count, index) => ({
      text: `${OPTION_LETTERS[index] ?? 'A'}: ${labels[index] ?? ''} — ${count}`,
      count,
      correct: index === reveal.correctIndex,
    }));
  }
  if (reveal.type === 'estimate') {
    return reveal.bins.map((bin, index) => ({
      text: `${bin.from} to ${bin.to} — ${bin.count}`,
      count: bin.count,
      correct: reveal.inBandBins.includes(index),
    }));
  }
  const top = reveal.buckets.length - 1;
  return reveal.buckets.map((count, index) => ({
    text: `${index} in place — ${count}`,
    count,
    correct: index === top,
  }));
}

export function estimateAnswerLine(reveal: Reveal, question: PlayerQuestion | null): string | null {
  if (reveal.type !== 'estimate') return null;
  const unit = question && question.type === 'estimate' ? question.unit : '';
  return `Answer: ${reveal.answer}${unit ? ` ${unit}` : ''} ± ${reveal.tolerance}`;
}

export function correctOrderLabels(
  reveal: Reveal,
  question: PlayerQuestion | null,
): string[] | null {
  if (reveal.type !== 'sequence') return null;
  const labels = new Map<string, string>();
  if (question && question.type === 'sequence') {
    for (const item of question.items) labels.set(item.id, item.label);
  }
  return reveal.correctOrder.map((id) => labels.get(id) ?? '');
}
