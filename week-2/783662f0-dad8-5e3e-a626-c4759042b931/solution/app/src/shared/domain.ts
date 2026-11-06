/** Domain constants published in the brief, shared by server and browser. */

export type PlanId = 'hamlet' | 'borough';

interface Plan {
  readonly id: PlanId;
  readonly name: string;
  readonly price: string;
  readonly characters: number;
  readonly members: number;
  readonly killbillPlan: string;
  readonly product: string;
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  hamlet: {
    id: 'hamlet',
    name: 'Hamlet',
    price: '6.00',
    characters: 12,
    members: 6,
    killbillPlan: 'hamlet-monthly',
    product: 'Hamlet',
  },
  borough: {
    id: 'borough',
    name: 'Borough',
    price: '12.00',
    characters: 40,
    members: 20,
    killbillPlan: 'borough-monthly',
    product: 'Borough',
  },
};

export const PLAN_IDS: readonly PlanId[] = ['hamlet', 'borough'];

export type PackId = 'pouch' | 'satchel' | 'chest';

interface Pack {
  readonly id: PackId;
  readonly name: string;
  readonly coins: number;
  readonly price: string;
}

export const PACKS: Readonly<Record<PackId, Pack>> = {
  pouch: { id: 'pouch', name: 'Pouch', coins: 100, price: '1.00' },
  satchel: { id: 'satchel', name: 'Satchel', coins: 550, price: '5.00' },
  chest: { id: 'chest', name: 'Chest', coins: 1200, price: '10.00' },
};

export const PACK_IDS: readonly PackId[] = ['pouch', 'satchel', 'chest'];

export type ItemKind =
  | 'wood'
  | 'stone'
  | 'brick'
  | 'glass'
  | 'fence'
  | 'signpost'
  | 'window'
  | 'milestone'
  | 'lantern'
  | 'compass'
  | 'rope'
  | 'trowel'
  | 'whistle'
  | 'map_case';

export const ITEM_NAMES: Readonly<Record<ItemKind, string>> = {
  wood: 'wood block',
  stone: 'stone block',
  brick: 'brick block',
  glass: 'glass block',
  fence: 'fence',
  signpost: 'signpost',
  window: 'window',
  milestone: 'milestone',
  lantern: 'lantern',
  compass: 'compass',
  rope: 'rope',
  trowel: 'trowel',
  whistle: 'whistle',
  map_case: 'map case',
};

const ITEM_KINDS = Object.keys(ITEM_NAMES) as readonly ItemKind[];

export const isItemKind = (value: string): value is ItemKind =>
  Object.prototype.hasOwnProperty.call(ITEM_NAMES, value) && ITEM_KINDS.includes(value as ItemKind);

export type Material = 'wood' | 'stone' | 'brick' | 'glass';
export const MATERIALS: readonly Material[] = ['wood', 'stone', 'brick', 'glass'];
export const isMaterial = (value: string): value is Material =>
  MATERIALS.includes(value as Material);

/** The loadout items, in listbox order. */
export const LOADOUT_ITEMS: readonly ItemKind[] = [
  'compass',
  'rope',
  'lantern',
  'trowel',
  'whistle',
  'map_case',
];

export type Appearance = 'surveyor' | 'mason' | 'pilot' | 'gardener';
export const APPEARANCES: readonly Appearance[] = ['surveyor', 'mason', 'pilot', 'gardener'];
export const APPEARANCE_NAMES: Readonly<Record<Appearance, string>> = {
  surveyor: 'Surveyor',
  mason: 'Mason',
  pilot: 'Pilot',
  gardener: 'Gardener',
};

interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly inputs: readonly { readonly kind: ItemKind; readonly count: number }[];
  readonly output: { readonly kind: ItemKind; readonly count: number };
}

export const RECIPES: readonly Recipe[] = [
  {
    id: 'fence',
    name: 'Fence',
    inputs: [{ kind: 'wood', count: 2 }],
    output: { kind: 'fence', count: 1 },
  },
  {
    id: 'signpost',
    name: 'Signpost',
    inputs: [
      { kind: 'wood', count: 1 },
      { kind: 'fence', count: 1 },
    ],
    output: { kind: 'signpost', count: 1 },
  },
  {
    id: 'window',
    name: 'Window',
    inputs: [
      { kind: 'glass', count: 1 },
      { kind: 'wood', count: 2 },
    ],
    output: { kind: 'window', count: 1 },
  },
  {
    id: 'milestone',
    name: 'Milestone',
    inputs: [{ kind: 'stone', count: 3 }],
    output: { kind: 'milestone', count: 1 },
  },
  {
    id: 'lantern',
    name: 'Lantern',
    inputs: [
      { kind: 'glass', count: 1 },
      { kind: 'brick', count: 1 },
    ],
    output: { kind: 'lantern', count: 1 },
  },
];

export const WORLD_WIDTH = 40;
export const WORLD_HEIGHT = 24;
export const SPAWN = { x: 16, y: 8 } as const;
export const INVENTORY_SLOTS = 24;
export const STACK_MAX = 64;
export const MAX_CHARACTERS_PER_USER = 3;
export const TRADE_ACCEPT_SECONDS = 60;
export const MAX_PURCHASES_PER_DAY = 5;

export type TileCode = '.' | '~' | '=' | '#' | 's' | 'T';

export const TILE_LABELS: Readonly<Record<TileCode, string>> = {
  '.': 'Grass',
  '~': 'Water',
  '=': 'Road',
  '#': 'Runway',
  s: 'Sand',
  T: 'Table',
};

export const PASSABLE: Readonly<Record<TileCode, boolean>> = {
  '.': true,
  '~': false,
  '=': true,
  '#': true,
  s: true,
  T: false,
};

export type GameKind = 'chess' | 'four' | 'tricks';

export const GAME_NAMES: Readonly<Record<GameKind, string>> = {
  chess: 'Chess',
  four: 'Four in a row',
  tricks: 'Card game',
};

export const SEAT_LABELS: Readonly<Record<GameKind, readonly string[]>> = {
  chess: ['White', 'Black'],
  four: ['Ink', 'Gold'],
  tricks: ['North', 'East', 'South', 'West'],
};

export const seatCount = (game: GameKind): number => SEAT_LABELS[game].length;

interface ChapterCheckpoint {
  readonly n: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

interface Chapter {
  readonly id: string;
  readonly title: string;
  readonly checkpoints: readonly ChapterCheckpoint[];
}

export const CHAPTERS: readonly Chapter[] = [
  {
    id: 'surveyors-pegs',
    title: "The Surveyor's Pegs",
    checkpoints: [
      { n: 1, name: 'Old Well', x: 8, y: 12 },
      { n: 2, name: 'Mill Gate', x: 24, y: 12 },
      { n: 3, name: 'Runway Beacon', x: 34, y: 3 },
    ],
  },
];

export type AchievementId =
  | 'first_stone'
  | 'groundbreaker'
  | 'smooth_landing'
  | 'long_haul'
  | 'checkmate_artist'
  | 'four_down'
  | 'trick_taker'
  | 'maker';

export const ACHIEVEMENT_NAMES: Readonly<Record<AchievementId, string>> = {
  first_stone: 'First Stone',
  groundbreaker: 'Groundbreaker',
  smooth_landing: 'Smooth Landing',
  long_haul: 'Long Haul',
  checkmate_artist: 'Checkmate Artist',
  four_down: 'Four Down',
  trick_taker: 'Trick Taker',
  maker: 'Maker',
};

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['C', 'D', 'H', 'S'] as const;
type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

const RANK_NAMES: Readonly<Record<Rank, string>> = {
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  T: 'Ten',
  J: 'Jack',
  Q: 'Queen',
  K: 'King',
  A: 'Ace',
};

const SUIT_NAMES: Readonly<Record<Suit, string>> = {
  C: 'Clubs',
  D: 'Diamonds',
  H: 'Hearts',
  S: 'Spades',
};

export const cardName = (card: string): string => {
  const rank = card.slice(0, 1) as Rank;
  const suit = card.slice(1, 2) as Suit;
  return `${RANK_NAMES[rank]} of ${SUIT_NAMES[suit]}`;
};

export const PIECE_NAMES: Readonly<Record<string, string>> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

/** Inventory cell names: a1 is slot 1, f4 is slot 24. */
const CELL_COLUMNS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

export const slotToCell = (slot: number): string => {
  const index = slot - 1;
  return `${CELL_COLUMNS[index % 6]}${Math.floor(index / 6) + 1}`;
};

export const TIME_ZONES: readonly string[] = [
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Istanbul',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Mexico_City',
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Anchorage',
  'Pacific/Honolulu',
];
