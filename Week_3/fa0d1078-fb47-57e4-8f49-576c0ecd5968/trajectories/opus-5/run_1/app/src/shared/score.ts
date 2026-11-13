import type { Level } from './puzzles';

const BASE: Record<Level, number> = {
  easy: 1500,
  medium: 3000,
  hard: 4500,
  expert: 6000,
};

/** `max(base / 10, base - S - 150 x M - 300 x H)` for a won game. */
export function scoreFor(level: Level, seconds: number, mistakes: number, hints: number): number {
  const base = BASE[level];
  return Math.max(base / 10, base - seconds - 150 * mistakes - 300 * hints);
}

/** `MM:SS`, or `H:MM:SS` from one hour. */
export function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

export function winRatePercent(won: number, started: number): number | null {
  if (started === 0) return null;
  return Math.round((won / started) * 100);
}
