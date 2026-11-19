import type { PollResultJson } from '../../shared/types.js';
import { percentOf } from '../../shared/rules.js';
import { ApiError } from '../http.js';

/** DP-19: the one place a new poll's question and options are judged. */
export function judgePoll(question: unknown, options: unknown): { question: string; options: string[] } {
  const text = typeof question === 'string' ? question.trim() : '';
  if (text.length < 1 || text.length > 200) {
    throw new ApiError(422, 'Write a question of 1 to 200 characters.');
  }
  const list = Array.isArray(options) ? options.map((option) => (typeof option === 'string' ? option.trim() : '')) : [];
  if (list.length < 2 || list.length > 6) {
    throw new ApiError(422, 'Give 2 to 6 options.');
  }
  if (list.some((option) => option.length < 1 || option.length > 80)) {
    throw new ApiError(422, 'Each option needs 1 to 80 characters.');
  }
  const seen = new Set(list.map((option) => option.toLowerCase()));
  if (seen.size !== list.length) {
    throw new ApiError(422, 'Options must be different.');
  }
  return { question: text, options: list };
}

/** DP-20: a poll's final tally with percentages rounded half up. */
export function tally(options: string[], counts: number[]): { total: number; results: PollResultJson[] } {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const results = options.map((option, index) => {
    const count = counts[index] ?? 0;
    return { option, count, percent: percentOf(count, total) };
  });
  return { total, results };
}
