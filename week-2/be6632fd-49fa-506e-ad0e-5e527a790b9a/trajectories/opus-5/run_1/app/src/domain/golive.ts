import { COPENHAGEN_ZONE, MARKETS, marketZone, type Market } from './markets.ts';
import {
  formatDateParts,
  formatTimeOfDay,
  pseudoToWall,
  resolveWall,
  wallOf,
  wallToPseudo,
  type Wall,
} from './time.ts';

export const DROP_TYPES = ['simultaneous', 'rolling'] as const;
export type DropType = (typeof DROP_TYPES)[number];

export function isDropType(value: unknown): value is DropType {
  return typeof value === 'string' && (DROP_TYPES as readonly string[]).includes(value);
}

export interface MarketOpening {
  market: Market;
  instantMs: number;
  /** The local wall-clock time the market actually opens at, after any gap shift. */
  localTime: string;
  /** Set when the market's own spring-forward gap held the chosen time. */
  shiftedTo: string | null;
}

/** The instant a simultaneous drop opens in every market, from a Copenhagen local time. */
export interface CopenhagenResolution {
  kind: 'ok' | 'gap';
  instantMs: number;
  /** The Copenhagen date of the gap, for the refusal message. */
  gapDate: string;
}

export function resolveCopenhagenGoLive(wall: Wall): CopenhagenResolution {
  const resolved = resolveWall(COPENHAGEN_ZONE, wall);
  return {
    kind: resolved.kind === 'gap' ? 'gap' : 'ok',
    instantMs: resolved.instantMs,
    gapDate: formatDateParts(wall),
  };
}

/** Each market's opening for a simultaneous drop: one shared instant. */
export function simultaneousOpenings(instantMs: number): MarketOpening[] {
  return MARKETS.map((market) => ({
    market,
    instantMs,
    localTime: formatTimeOfDay(wallOf(marketZone(market), instantMs)),
    shiftedTo: null,
  }));
}

/** Each market's opening for a rolling drop: the same local time in each market's own zone. */
export function rollingOpenings(wall: Wall): MarketOpening[] {
  return MARKETS.map((market) => {
    const resolved = resolveWall(marketZone(market), wall);
    const shifted = resolved.kind === 'gap';
    const localWall = shifted ? pseudoToWall(wallToPseudo(wall) + resolved.gapMs) : wall;
    return {
      market,
      instantMs: resolved.instantMs,
      localTime: formatTimeOfDay(localWall),
      shiftedTo: shifted ? formatTimeOfDay(localWall) : null,
    };
  });
}

export function earliestOpening(openings: MarketOpening[]): number | null {
  const instants = openings.map((opening) => opening.instantMs);
  return instants.length === 0 ? null : Math.min(...instants);
}
