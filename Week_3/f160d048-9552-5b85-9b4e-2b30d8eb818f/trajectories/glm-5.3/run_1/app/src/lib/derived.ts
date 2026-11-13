// Derived values computed on the server from approved records only.
import { config } from './config.js';

// Round half up to one decimal on the exact mean.
export function ratingAverage(sum: number, count: number): number | null {
  if (count === 0) return null;
  const mean = sum / count;
  return Math.round(mean * 10) / 10;
}

// Interpolated linear between closest ranks, rounded half up to whole rupees.
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const rank = (p / 100) * (n - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const weight = rank - low;
  const exact = sorted[low] + (sorted[high] - sorted[low]) * weight;
  return Math.round(exact);
}

export interface Band {
  low: number;
  median: number;
  high: number;
}

export function payBand(values: number[]): Band | null {
  const threshold = config().minPayReports;
  if (values.length < threshold) return null;
  return {
    low: percentile(values, 25),
    median: percentile(values, 50),
    high: percentile(values, 75),
  };
}

export function threshold(): number {
  return config().minPayReports;
}
