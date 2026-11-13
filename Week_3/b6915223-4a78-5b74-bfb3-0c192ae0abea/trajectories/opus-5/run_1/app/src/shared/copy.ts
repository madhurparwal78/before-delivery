import type { ChipCode } from './types.ts';

export const CHIP_NAMES: Record<ChipCode, string> = {
  wildcard: 'Wildcard',
  free_hit: 'Free Hit',
  bench_boost: 'Bench Boost',
  triple_captain: 'Triple Captain',
};

export const CHIP_ORDER: ChipCode[] = ['wildcard', 'free_hit', 'bench_boost', 'triple_captain'];

export const deadlineCopy = (gameweek: number): string =>
  `Deadline passed. Gameweek ${gameweek} is locked, so this change was not saved.`;

export const lockedBannerCopy = (gameweek: number): string =>
  `Gameweek ${gameweek} is locked. Pick Team and Transfers reopen when the next gameweek opens.`;

export const RECEIPT_STORED = 'Team locked, receipt stored';
export const RECEIPT_PENDING =
  'Receipt pending. Your locked team is safe; the file will be stored when storage is back.';

export const SIGNIN_OUTAGE = 'Sign-in is unavailable right now. Try again in a minute.';
export const INBOX_OUTAGE = 'Notices are delayed. They will appear here when the inbox is back.';
export const STORAGE_OUTAGE = 'Storage is unreachable. Try the download again in a minute.';
export const RECEIPT_PENDING_DOWNLOAD =
  'The receipt is still pending. Try again when it shows as stored.';

export const chipRefusalCopy = (code: string, chip: ChipCode): string => {
  switch (code) {
    case 'chip_already_this_gameweek':
      return 'Only one chip can be played in a gameweek.';
    case 'chip_used':
      return `${CHIP_NAMES[chip]} has already been used in this half of the season.`;
    case 'free_hit_back_to_back':
      return 'Free Hit cannot be played in two gameweeks in a row.';
    case 'chip_after_transfers':
      return `${CHIP_NAMES[chip]} must be played before making transfers this gameweek.`;
    case 'chip_locked_in':
      return `${CHIP_NAMES[chip]} cannot be cancelled once played.`;
    default:
      return 'That chip cannot be played now.';
  }
};

export const EVENT_LABELS: Record<string, string> = {
  minutes: 'minutes played',
  goal: 'goal',
  assist: 'assist',
  clean_sheet: 'clean sheet',
  yellow_card: 'yellow card',
  red_card: 'red card',
  own_goal: 'own goal',
  bonus: 'bonus',
};

export const noticeMessage = {
  deadlineLocked: (n: number) => `Gameweek ${n} is locked. Your team is set.`,
  transferRefused: (n: number) =>
    `Your change for gameweek ${n} arrived after the deadline and was not saved.`,
  autoSub: (nameIn: string, nameOut: string, n: number) =>
    `${nameIn} came on for ${nameOut} in gameweek ${n}.`,
  captainFallback: (viceName: string, n: number) =>
    `${viceName} took the armband in gameweek ${n}.`,
  priceChange: (name: string, rose: boolean, priceMillions: string) =>
    `${name} ${rose ? 'rose' : 'fell'} to ${priceMillions}m.`,
};
