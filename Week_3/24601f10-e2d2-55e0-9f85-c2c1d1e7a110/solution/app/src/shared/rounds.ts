import type { Bracket, CurrentRound, Format, MatchState, SlotView } from './api.js';

// The current-round rule, decided once for the server (tournament.current_round) and the client (region scroll and tab stops).
interface RoundItem { bracket: Bracket; round: number; open: boolean }

const OPEN_STATES: readonly MatchState[] = ['pending', 'called', 'reported', 'disputed'];
const isEntrant = (slot: SlotView): boolean => slot !== null && 'entrant_id' in slot;

// An open match is pending, called, reported or disputed with both entrants known.
export const isOpen = (state: MatchState, upper: SlotView, lower: SlotView): boolean =>
  OPEN_STATES.includes(state) && isEntrant(upper) && isEntrant(lower);

export function regionCurrentRound(items: RoundItem[], bracket: Bracket): number | null {
  const region = items.filter((item) => item.bracket === bracket);
  if (!region.length) return null;
  const open = region.filter((item) => item.open).map((item) => item.round);
  return open.length ? Math.min(...open) : Math.max(...region.map((item) => item.round));
}

export function overallCurrentRound(format: Format, items: RoundItem[]): CurrentRound | null {
  const order: Bracket[] = format === 'double_elimination' ? ['winners', 'losers', 'final'] : ['main'];
  for (const bracket of order) {
    if (items.some((item) => item.bracket === bracket && item.open)) {
      return { bracket, round: regionCurrentRound(items, bracket) as number };
    }
  }
  const last = order[order.length - 1] as Bracket;
  const round = regionCurrentRound(items, last);
  return round === null ? null : { bracket: last, round };
}
