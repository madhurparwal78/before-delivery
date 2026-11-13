import type { ApiMatch, Slot } from './types';

export const TBD = 'to be decided';

export const slotName = (slot: Slot): string => {
  if (slot === null) return TBD;
  if ('bye' in slot) return 'bye';
  return slot.name;
};

const isBye = (slot: Slot): boolean => slot !== null && 'bye' in slot;

export const slotEntrantId = (slot: Slot): string | null =>
  slot !== null && 'entrant_id' in slot ? slot.entrant_id : null;

export const scoreText = (upper: number | null, lower: number | null): string =>
  upper === null || lower === null ? 'not played' : `${upper}-${lower}`;

/** The published card grammar. `overdue` is appended for organizers only. */
export const cardName = (match: ApiMatch, showOverdue = false): string => {
  const label = match.label;
  const upper = slotName(match.upper);
  const lower = slotName(match.lower);
  const pair = `${upper} vs ${lower}`;
  const overdue = showOverdue && match.overdue ? ', overdue' : '';

  switch (match.state) {
    case 'not_needed':
      return `${label}: not needed`;
    case 'waiting':
      return `${label}: waiting for grand final`;
    case 'bye': {
      const real = isBye(match.upper) ? lower : upper;
      return `${label}: ${real} vs bye`;
    }
    case 'called':
      return `${label}: ${pair}, called${overdue}`;
    case 'reported': {
      const reporter = match.report ? match.report.by : '';
      const opponent = reporter === upper ? lower : upper;
      const games = match.report ? `${match.report.upper_games}-${match.report.lower_games}` : '';
      return `${label}: ${pair}, ${games} reported by ${reporter}, awaiting ${opponent}`;
    }
    case 'disputed':
      return `${label}: ${pair}, disputed`;
    case 'confirmed':
    case 'resolved': {
      const games = `${match.upper_games}-${match.lower_games}`;
      if (match.winner === 'draw') return `${label}: ${pair}, ${games}, draw`;
      const winnerName = match.winner === 'upper' ? upper : lower;
      return `${label}: ${pair}, ${games}, ${winnerName} wins`;
    }
    case 'pending':
    default: {
      if (match.upper === null || match.lower === null) return `${label}: ${pair}`;
      return `${label}: ${pair}, not played${overdue}`;
    }
  }
};

export const ordinal = (n: number): string => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

export const historyRowText = (
  tournamentName: string,
  place: number,
  fieldSize: number,
  finishedOn: string,
): string => `${tournamentName} · ${ordinal(place)} of ${fieldSize} · ${finishedOn}`;

export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** Whole numbers print plain; halves print with one decimal. */
export const halfNumber = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
