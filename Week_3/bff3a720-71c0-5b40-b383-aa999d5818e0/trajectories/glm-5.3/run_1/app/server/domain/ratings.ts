import type { Config } from './config.js';

/** Rating window and reveal rule. */

export type RatingState = 'not_open' | 'open' | 'waiting' | 'revealed' | 'closed';

export function ratingOpens(arrival: number): number {
  return arrival;
}

export function ratingCloses(arrival: number, cfg: Config): number {
  return arrival + cfg.ratingWindowDays * 86_400_000;
}
