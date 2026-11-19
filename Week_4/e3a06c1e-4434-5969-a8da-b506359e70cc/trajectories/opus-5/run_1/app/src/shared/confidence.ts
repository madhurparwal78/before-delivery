import type { ConfidenceBand } from './types.js';

export const FLAG_THRESHOLD = 0.85;

export const confidenceBand = (confidence: number): ConfidenceBand => {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
};

export const isFlagged = (confidences: readonly number[]): boolean =>
  confidences.length > 0 && Math.min(...confidences) < FLAG_THRESHOLD;
