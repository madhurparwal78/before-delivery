/** The desk's top-bar links, in their published order. */
export const DESK_LINKS: readonly { href: string; label: string }[] = [
  { href: '/pieces', label: 'Pieces' },
  { href: '/clients', label: 'Clients' },
  { href: '/library', label: 'Library' },
  { href: '/bench', label: 'Bench' },
  { href: '/workbook', label: 'Workbook' },
  { href: '/rates', label: 'Rates' },
];

export const PIECE_STATE_NAMES = {
  received: 'Received',
  inSurvey: 'In survey',
  onTheBench: 'On the bench',
  ready: 'Ready',
  collected: 'Collected',
  archived: 'Archived',
} as const;

export type PieceStateKey = keyof typeof PIECE_STATE_NAMES;

export const PIECE_STATE_KEYS = Object.keys(PIECE_STATE_NAMES) as PieceStateKey[];

export const TOWN_NAMES_EN = ['Turin', 'London', 'New York', 'Kyoto', 'Dubai'] as const;

export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ar', label: 'Arabic' },
] as const;

export const BENCH_OPTIONS = [
  { value: 'frame', label: 'Frame bench' },
  { value: 'cover', label: 'Cover bench' },
] as const;

export const PIN_KIND_OPTIONS = [
  { value: 'tear', label: 'Tear' },
  { value: 'crack', label: 'Crack' },
  { value: 'stain', label: 'Stain' },
  { value: 'looseJoint', label: 'Loose joint' },
  { value: 'woodworm', label: 'Woodworm' },
] as const;

export const SORT_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'dueDate', label: 'Due date' },
] as const;
