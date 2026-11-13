import type { Bracket, Format, MatchState, MatchView, SlotView } from '../shared/api.js';

// How matches are named, grouped into regions and walked with the keyboard: presentation rules from the brief.
export const STATUS_WORDS: Record<MatchState, string> = {
  pending: 'Pending', called: 'Called', reported: 'Awaiting confirmation', confirmed: 'Confirmed', disputed: 'Disputed',
  resolved: 'Resolved', bye: 'Bye', not_needed: 'Not needed', waiting: 'Waiting',
};

const TO_BE_DECIDED = 'to be decided';

export function slotName(slot: SlotView): string {
  if (slot === null) return TO_BE_DECIDED;
  return 'bye' in slot ? 'bye' : slot.name;
}

const entrantName = (slot: SlotView): string => (slot !== null && 'name' in slot ? slot.name : '');

export function winnerName(m: MatchView): string {
  return m.winner === 'upper' ? entrantName(m.upper) : m.winner === 'lower' ? entrantName(m.lower) : '';
}

// The accessible name of a match card, in every state.
export function cardName(m: MatchView): string {
  const upper = slotName(m.upper);
  const lower = slotName(m.lower);
  const overdue = m.overdue === true ? ', overdue' : '';
  const score = `${m.upper_games}-${m.lower_games}`;
  switch (m.state) {
    case 'not_needed': return `${m.label}: not needed`;
    case 'waiting': return `${m.label}: waiting for grand final`;
    case 'bye': return upper === 'bye' ? `${m.label}: ${lower} vs bye` : `${m.label}: ${upper} vs bye`;
    case 'pending':
      return m.upper !== null && m.lower !== null && 'entrant_id' in m.upper && 'entrant_id' in m.lower
        ? `${m.label}: ${upper} vs ${lower}, not played${overdue}` : `${m.label}: ${upper} vs ${lower}`;
    case 'called': return `${m.label}: ${upper} vs ${lower}, called${overdue}`;
    case 'reported': {
      const report = m.report as NonNullable<MatchView['report']>;
      const opponent = report.by === upper ? lower : upper;
      return `${m.label}: ${upper} vs ${lower}, ${report.upper_games}-${report.lower_games} reported by ${report.by}, awaiting ${opponent}`;
    }
    case 'disputed': return `${m.label}: ${upper} vs ${lower}, disputed`;
    case 'confirmed':
    case 'resolved':
      return m.winner === 'draw' ? `${m.label}: ${upper} vs ${lower}, ${score}, draw`
        : `${m.label}: ${upper} vs ${lower}, ${score}, ${winnerName(m)} wins`;
  }
}

export interface RoundColumn {
  bracket: Bracket;
  round: number;
  label: string;
  tabName: string;
  matches: MatchView[];
}

export interface RegionModel {
  name: string;
  bracket: Bracket;
  rounds: RoundColumn[];
}

const BRACKET_ORDER: Record<Bracket, number> = { winners: 0, losers: 1, final: 2, main: 3 };

export const orderMatches = (matches: MatchView[]): MatchView[] =>
  [...matches].sort((a, b) => BRACKET_ORDER[a.bracket] - BRACKET_ORDER[b.bracket] || a.round - b.round || a.number - b.number);

function columns(matches: MatchView[], bracket: Bracket, label: (round: number) => string, tab: (round: number) => string): RoundColumn[] {
  const rounds = [...new Set(matches.filter((m) => m.bracket === bracket).map((m) => m.round))].sort((a, b) => a - b);
  return rounds.map((round) => ({ bracket, round, label: label(round), tabName: tab(round),
    matches: matches.filter((m) => m.bracket === bracket && m.round === round).sort((a, b) => a.number - b.number) }));
}

export function buildRegions(format: Format, matches: MatchView[]): RegionModel[] {
  if (format === 'double_elimination') {
    return [
      { name: 'Winners bracket', bracket: 'winners', rounds: columns(matches, 'winners', (r) => `Winners round ${r}`, (r) => `Winners ${r}`) },
      { name: 'Losers bracket', bracket: 'losers', rounds: columns(matches, 'losers', (r) => `Losers round ${r}`, (r) => `Losers ${r}`) },
      { name: 'Grand final', bracket: 'final', rounds: columns(matches, 'final', (r) => (r === 1 ? 'Grand final' : 'Grand final reset'), () => 'Grand final') },
    ];
  }
  const rounds = columns(matches, 'main', (r) => `Round ${r}`, (r) => `Round ${r}`);
  return [{ name: format === 'single_elimination' ? 'Bracket' : 'Rounds', bracket: 'main', rounds }];
}

export interface PhoneTab { name: string; bracket: Bracket; rounds: RoundColumn[] }

// Phone tabs: one per round; in double elimination the grand final and its reset share one tab.
export function phoneTabs(regions: RegionModel[]): PhoneTab[] {
  return regions.flatMap((region) => (region.bracket === 'final'
    ? (region.rounds.length ? [{ name: 'Grand final', bracket: region.bracket, rounds: region.rounds }] : [])
    : region.rounds.map((round) => ({ name: round.tabName, bracket: region.bracket, rounds: [round] }))));
}

const isDropIn = (round: number): boolean => round >= 2 && round % 2 === 0;

export function nextFocus(region: RegionModel, match: MatchView, key: string, format: Format): MatchView | null {
  const round = region.rounds.find((r) => r.round === match.round);
  if (!round) return null;
  const at = round.matches.indexOf(match);
  const inRound = (target: RoundColumn | undefined, number: number): MatchView | null => {
    if (!target?.matches.length) return null;
    return target.matches[Math.min(Math.max(number, 1), target.matches.length) - 1] ?? null;
  };
  const sideways = format === 'round_robin' || format === 'swiss';
  const final = region.bracket === 'final';
  const losers = region.bracket === 'losers';
  switch (key) {
    case 'ArrowDown': return round.matches[at + 1] ?? null;
    case 'ArrowUp': return at > 0 ? round.matches[at - 1] ?? null : null;
    case 'Home': return region.rounds[0]?.matches[0] ?? null;
    case 'End': return region.rounds[region.rounds.length - 1]?.matches[0] ?? null;
    case 'ArrowRight': {
      const target = region.rounds.find((r) => r.round === match.round + 1);
      if (!target) return null;
      if (final) return target.matches[0] ?? null;
      if (sideways) return inRound(target, match.number);
      return inRound(target, losers && isDropIn(match.round + 1) ? match.number : Math.ceil(match.number / 2));
    }
    case 'ArrowLeft': {
      const target = region.rounds.find((r) => r.round === match.round - 1);
      if (!target) return null;
      if (final) return target.matches[0] ?? null;
      if (sideways) return inRound(target, match.number);
      return inRound(target, losers && isDropIn(match.round) ? match.number : 2 * match.number - 1);
    }
    default: return null;
  }
}

// The match a winner feeds, within the region: the ArrowRight rule, which also draws the connectors.
export const winnerTarget = (region: RegionModel, match: MatchView, format: Format): MatchView | null =>
  nextFocus(region, match, 'ArrowRight', format);

interface CardViewer { organizer: boolean; entrantId: string | null; entrantName: string | null }
export type CardDialog = 'report' | 'confirm' | 'resolve' | 'details';

const isEntrant = (slot: SlotView): slot is { entrant_id: string; name: string } => slot !== null && 'entrant_id' in slot;

// Which dialog a card opens, by who is looking and the card's state.
export function dialogFor(match: MatchView, viewer: CardViewer): CardDialog {
  const ready = isEntrant(match.upper) && isEntrant(match.lower);
  const mine = [match.upper, match.lower].some((slot) => isEntrant(slot) && slot.entrant_id === viewer.entrantId);
  if (viewer.organizer) {
    if (match.state === 'disputed') return 'resolve';
    return ready && ['pending', 'called', 'reported'].includes(match.state) ? 'report' : 'details';
  }
  if (mine && ready && ['pending', 'called'].includes(match.state)) return 'report';
  if (mine && match.state === 'reported' && match.report?.by !== viewer.entrantName) return 'confirm';
  return 'details';
}

// The card the Shutter trace path comes from: the reached card whose winner feeds this one, else the nearest earlier one.
export function pickFeeder(regions: RegionModel[], format: Format, dependentId: string, reached: string[]): string {
  const all = regions.flatMap((region) => region.rounds.flatMap((round) => round.matches.map((match) => ({ region, match }))));
  const target = all.find((x) => x.match.id === dependentId);
  if (!target) return reached[0] as string;
  const direct = reached.find((id) => {
    const from = all.find((x) => x.match.id === id);
    return from && from.region === target.region && winnerTarget(from.region, from.match, format)?.id === dependentId;
  });
  if (direct) return direct;
  const earlier = reached.filter((id) => (all.find((x) => x.match.id === id)?.match.round ?? 0) < target.match.round);
  return earlier[earlier.length - 1] ?? (reached[0] as string);
}
