// The parts of the laws the browser also needs to word or to offer: which wickets a delivery allows, whether it is
// legal, and how its runs read. The server's laws engine is the only place that decides with them.
import type { Extra, WicketKind } from './wire.js';

export const BALLS_PER_OVER = 6;
export const MAX_RUNS = 6;
export const MAX_RUN_OUT_RUNS = 3;
/** A wide and a no-ball each add one run to what the batters ran or hit. */
export const PENALTY_RUNS = 1;

const EXTRAS: readonly Extra[] = ['none', 'wide', 'no-ball', 'bye', 'leg-bye'];
export const WICKET_KINDS: readonly WicketKind[] = ['bowled', 'caught', 'lbw', 'stumped', 'hit-wicket', 'run-out'];

export const isExtra = (value: unknown): value is Extra => EXTRAS.includes(value as Extra);
export const isWicketKind = (value: unknown): value is WicketKind => WICKET_KINDS.includes(value as WicketKind);

/** Caught, stumped and run out name the fielder. */
export const needsFielder = (kind: WicketKind): boolean => kind === 'caught' || kind === 'stumped' || kind === 'run-out';

/** A short name defaults to the last word of the full name. */
export const defaultShortName = (name: string): string => name.trim().split(/\s+/).pop() ?? '';

const ALLOWED_ON: Record<Extra, readonly WicketKind[]> = {
  none: WICKET_KINDS,
  wide: ['stumped', 'run-out'],
  'no-ball': ['run-out'],
  bye: ['run-out'],
  'leg-bye': ['run-out'],
};

/** Whether a wicket of this kind can happen on a delivery of this kind; only a run out can on a free hit. */
export const wicketAllowed = (kind: WicketKind, extra: Extra, freeHit: boolean): boolean =>
  freeHit ? kind === 'run-out' : ALLOWED_ON[extra].includes(kind);

/** A legal delivery counts toward the over. */
export const isLegal = (extra: Extra): boolean => extra === 'none' || extra === 'bye' || extra === 'leg-bye';

/** Byes and leg byes are recorded with at least one run. */
export const needsRuns = (extra: Extra): boolean => extra === 'bye' || extra === 'leg-bye';

const OFF_THE_BAT = ['no run', '1 run', '2 runs', '3 runs', 'FOUR', '5 runs', 'SIX'] as const;

/** The runs part of a commentary line. */
export const runsPart = (extra: Extra, runs: number): string => {
  const offTheBat = OFF_THE_BAT[runs] ?? `${runs} runs`;
  switch (extra) {
    case 'none': return offTheBat;
    case 'wide': return `${runs + PENALTY_RUNS} ${runs + PENALTY_RUNS === 1 ? 'wide' : 'wides'}`;
    case 'no-ball': return `no-ball, ${offTheBat}`;
    case 'bye': return `${runs} ${runs === 1 ? 'bye' : 'byes'}`;
    case 'leg-bye': return `${runs} ${runs === 1 ? 'leg bye' : 'leg byes'}`;
  }
};

/** The runs the scorer entered for a delivery, from what the commentary item says it scored. */
export const enteredRuns = (item: { extra: Extra; runs: number; bat_runs: number; extra_runs: number }): number =>
  item.extra === 'wide' ? item.runs - PENALTY_RUNS : needsRuns(item.extra) ? item.extra_runs : item.bat_runs;
