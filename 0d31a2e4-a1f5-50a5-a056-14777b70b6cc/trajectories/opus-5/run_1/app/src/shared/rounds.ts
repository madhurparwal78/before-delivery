import type { RoundKind } from './types.js';

export const TICK_RATE = 20;
export const LOBBY_SIZE = 12;
export const PARTY_MAX = 4;
export const COUNTDOWN_SECONDS = 10;
export const ROUND_PENDING_SECONDS = 5;

interface RoundSpec {
  kind: RoundKind;
  name: string;
  kindLabel: string;
  timeLimitSeconds: number;
}

const SPECS: Record<RoundKind, RoundSpec> = {
  race: { kind: 'race', name: 'Wobble Dash', kindLabel: 'Race', timeLimitSeconds: 60 },
  survival: { kind: 'survival', name: 'Sweeper Spin', kindLabel: 'Survival', timeLimitSeconds: 45 },
  final: { kind: 'final', name: 'Crown Climb', kindLabel: 'Final', timeLimitSeconds: 60 },
};

export const ROUND_ORDER: readonly RoundKind[] = ['race', 'survival', 'final'];

export function roundKindForNumber(n: number): RoundKind {
  const kind = ROUND_ORDER[n - 1];
  if (kind === undefined) throw new Error(`no round kind for round ${n}`);
  return kind;
}

export function roundName(kind: RoundKind): string {
  return SPECS[kind].name;
}

export function roundKindLabel(kind: RoundKind): string {
  return SPECS[kind].kindLabel;
}

export function timeLimitTicks(kind: RoundKind): number {
  return SPECS[kind].timeLimitSeconds * TICK_RATE;
}

/** The slot count of a round, derived once from its kind and its number of starters. */
export function slotsFor(kind: RoundKind, starterCount: number): number {
  switch (kind) {
    case 'race':
      return Math.ceil(0.6 * starterCount);
    case 'survival':
      return Math.ceil(0.5 * starterCount);
    case 'final':
      return 1;
  }
}

export function slotsLabel(kind: RoundKind): string {
  return kind === 'survival' ? 'Falls to go' : 'Slots left';
}
