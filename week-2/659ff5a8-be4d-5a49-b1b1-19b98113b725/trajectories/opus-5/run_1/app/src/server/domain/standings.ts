import type { RankChange, StandingsView } from '../../shared/api';

export interface EntryRun {
  runNumber: number;
  status: 'pending' | 'committed' | 'corrected' | 'rerun_granted';
  outcome: 'time' | 'dnf' | 'rerun' | null;
  adjustedMs: number | null;
  indexedMs: number | null;
}

export interface EntryInput {
  registrationId: string;
  carNumber: number;
  classCode: string;
  runs: EntryRun[];
}

export interface RankedEntry {
  registrationId: string;
  carNumber: number;
  classCode: string;
  bestAdjustedMs: number | null;
  bestIndexedMs: number | null;
  position: number | null;
  classPosition: number | null;
  rawPosition: number | null;
}

function isValidRun(run: EntryRun): boolean {
  return run.outcome === 'time' && (run.status === 'committed' || run.status === 'corrected');
}

function bestOf(values: (number | null)[]): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (best === null || value < best) best = value;
  }
  return best;
}

function tieBreak(a: RankedEntry, b: RankedEntry): number {
  if (a.carNumber !== b.carNumber) return a.carNumber - b.carNumber;
  return a.classCode.localeCompare(b.classCode);
}

function byTime(key: 'bestIndexedMs' | 'bestAdjustedMs') {
  return (a: RankedEntry, b: RankedEntry): number => {
    const left = a[key];
    const right = b[key];
    if (left === null || right === null) return 0;
    if (left !== right) return left - right;
    return tieBreak(a, b);
  };
}

function unrankedOrder(a: RankedEntry, b: RankedEntry): number {
  const byClass = a.classCode.localeCompare(b.classCode);
  if (byClass !== 0) return byClass;
  return a.carNumber - b.carNumber;
}

/** The one place standings positions are decided. */
export function rankEntries(entries: EntryInput[]): RankedEntry[] {
  const ranked: RankedEntry[] = entries.map((entry) => ({
    registrationId: entry.registrationId,
    carNumber: entry.carNumber,
    classCode: entry.classCode,
    bestAdjustedMs: bestOf(entry.runs.filter(isValidRun).map((run) => run.adjustedMs)),
    bestIndexedMs: bestOf(entry.runs.filter(isValidRun).map((run) => run.indexedMs)),
    position: null,
    classPosition: null,
    rawPosition: null,
  }));

  const timedIndexed = ranked.filter((entry) => entry.bestIndexedMs !== null);
  timedIndexed.sort(byTime('bestIndexedMs'));
  timedIndexed.forEach((entry, index) => {
    entry.position = index + 1;
  });

  const timedRaw = ranked.filter((entry) => entry.bestAdjustedMs !== null);
  timedRaw.sort(byTime('bestAdjustedMs'));
  timedRaw.forEach((entry, index) => {
    entry.rawPosition = index + 1;
  });

  const classes = new Set(ranked.map((entry) => entry.classCode));
  for (const classCode of classes) {
    const inClass = timedRaw.filter((entry) => entry.classCode === classCode);
    inClass.forEach((entry, index) => {
      entry.classPosition = index + 1;
    });
  }

  return ranked;
}

export function positionForView(entry: RankedEntry, view: StandingsView): number | null {
  if (view === 'indexed') return entry.position;
  if (view === 'class') return entry.classPosition;
  return entry.rawPosition;
}

/** The one place the rank-change badge text is written. */
export function rankChangeText(before: number | null, after: number | null): string {
  if (after === null) return 'No time';
  if (before === null) return `New P${after}`;
  if (before === after) return `Holds P${after}`;
  if (after < before) return `Up ${before - after} to P${after}`;
  return `Down ${after - before} to P${after}`;
}

export function rankChangeFor(before: RankedEntry | undefined, after: RankedEntry): RankChange {
  return {
    indexed: rankChangeText(before?.position ?? null, after.position),
    class: rankChangeText(before?.classPosition ?? null, after.classPosition),
    raw: rankChangeText(before?.rawPosition ?? null, after.rawPosition),
  };
}

/** Orders ranked entries for a view; entries with no valid time come last. */
export function orderForView(entries: RankedEntry[], view: StandingsView): RankedEntry[] {
  const ranked = entries.filter((entry) => positionForView(entry, view) !== null);
  const unranked = entries.filter((entry) => positionForView(entry, view) === null);
  if (view === 'class') {
    ranked.sort((a, b) => {
      const byClass = a.classCode.localeCompare(b.classCode);
      if (byClass !== 0) return byClass;
      return (a.classPosition ?? 0) - (b.classPosition ?? 0);
    });
  } else {
    const key = view === 'indexed' ? 'position' : 'rawPosition';
    ranked.sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0));
  }
  unranked.sort(unrankedOrder);
  return [...ranked, ...unranked];
}
