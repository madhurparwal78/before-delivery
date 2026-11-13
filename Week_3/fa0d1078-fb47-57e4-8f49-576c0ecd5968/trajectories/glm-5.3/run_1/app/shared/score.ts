import type { Level } from './puzzles.js';

// The score rule for a won game: max(base / 10, base - S - 150 x M - 300 x H),
// where base depends on the level, S is the whole seconds of active time,
// M the mistakes at the finish and H the hints used.
const BASE: Record<Level, number> = {
  easy: 1500,
  medium: 3000,
  hard: 4500,
  expert: 6000,
};

export function score(level: Level, seconds: number, mistakes: number, hints: number): number {
  const base = BASE[level];
  return Math.max(Math.floor(base / 10), base - seconds - 150 * mistakes - 300 * hints);
}

// The #timer format: MM:SS, or H:MM:SS from one hour.
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
