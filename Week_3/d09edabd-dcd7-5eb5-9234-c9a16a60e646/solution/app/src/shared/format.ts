const pad = (n: number): string => String(n).padStart(2, '0');

/** `mm:ss` from whole seconds. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** `m:ss` from whole seconds. */
export function mss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** `YYYY-MM-DD HH:MM` in UTC. */
export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export interface Stats {
  solved: number;
  total: number;
  longestRun: number;
  props: number;
}

export function figureStrings(stats: Stats): [string, string, string] {
  return [
    `${stats.solved} of ${stats.total} solved`,
    `Longest run ${stats.longestRun}`,
    stats.props === 1 ? '1 prop' : `${stats.props} props`,
  ];
}

export function figureLine(stats: Stats): string {
  return figureStrings(stats).join(' · ');
}

export function outcomeLine(outcome: Outcome, elapsedSeconds: number): string {
  if (outcome === 'escaped') return `Escaped in ${mmss(elapsedSeconds)}`;
  if (outcome === 'timed_out') return 'Out of time';
  return `Stopped at ${mmss(elapsedSeconds)}`;
}

export type Outcome = 'escaped' | 'timed_out' | 'stopped';
