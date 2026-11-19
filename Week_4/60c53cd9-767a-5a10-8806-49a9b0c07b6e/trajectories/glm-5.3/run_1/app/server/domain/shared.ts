// Domain vocabulary shared by the server and the browser. Every derived figure
// and label is decided here and only here.

export const BAND_IDS = ['03-09', '10-19', '20-29', '30-35', '36-38'] as const;
export type BandId = (typeof BAND_IDS)[number];

export const BAND_FLOORS: Record<BandId, [number, number]> = {
  '03-09': [3, 9],
  '10-19': [10, 19],
  '20-29': [20, 29],
  '30-35': [30, 35],
  '36-38': [36, 38],
};

export const STACKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type Stack = (typeof STACKS)[number];

export const BEDROOM_VALUES = ['1', '2', '3'] as const;
export const FACING_VALUES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Facing = (typeof FACING_VALUES)[number];
export const VIEW_VALUES = ['harbour', 'harbour-partial', 'park', 'city', 'ridge'] as const;
export type ViewTag = (typeof VIEW_VALUES)[number];
export const STATUS_VALUES = ['available', 'held', 'reserved'] as const;
export type UnitStatus = (typeof STATUS_VALUES)[number];

export const FACET_FIELDS = ['bedrooms', 'band', 'facing', 'view', 'status'] as const;
export type FacetField = (typeof FACET_FIELDS)[number];

export const SEARCH_TEXT_LIMIT = 80;
export const FACET_VALUE_LIMIT = 6;
export const PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 24;
export const PRICE_MIN = 100000;
export const PRICE_MAX = 20000000;
export const MAX_SAFE = 9007199254740991;

export function roundHalfUp(n: number): number {
  if (n >= 0) return Math.floor(n + 0.5);
  return -Math.floor(-n + 0.5);
}

export function areaSqft(areaM2: number): number {
  return roundHalfUp(areaM2 * 10.7639);
}

export function pricePerM2(price: number, m2: number): number {
  return roundHalfUp(price / m2);
}

export function pricePerSqft(price: number, sqft: number): number {
  return roundHalfUp(price / sqft);
}

export function facingForBearing(bearing: number): Facing {
  const b = ((bearing % 360) + 360) % 360;
  const table: Facing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(b / 45) % 8;
  return table[idx];
}

export function bandForFloor(floor: number): BandId {
  if (floor >= 36) return '36-38';
  if (floor >= 30) return '30-35';
  if (floor >= 20) return '20-29';
  if (floor >= 10) return '10-19';
  return '03-09';
}

export function unitCode(floor: number, stack: Stack): string {
  return `${floor}${stack}`;
}

export function codeFloor(code: string): number {
  return Number(code.slice(0, -1));
}

export function codeStack(code: string): Stack {
  return code.slice(-1) as Stack;
}

// Eight-point label from 45-degree sectors centred on each direction.
export const STACK_BEARINGS: Record<Stack, number> = {
  A: 134, B: 178, C: 214, D: 268, E: 311, F: 4, G: 41, H: 93,
};

export const STACK_META: Record<Stack, { bedrooms: number; areaM2: number; priceAt3: number; view: ViewTag }> = {
  A: { bedrooms: 2, areaM2: 78, priceAt3: 1020000, view: 'park' },
  B: { bedrooms: 2, areaM2: 74, priceAt3: 985000, view: 'park' },
  C: { bedrooms: 3, areaM2: 112, priceAt3: 1480000, view: 'harbour-partial' },
  D: { bedrooms: 2, areaM2: 71, priceAt3: 930000, view: 'harbour-partial' },
  E: { bedrooms: 1, areaM2: 52, priceAt3: 690000, view: 'ridge' },
  F: { bedrooms: 1, areaM2: 49, priceAt3: 655000, view: 'ridge' },
  G: { bedrooms: 2, areaM2: 76, priceAt3: 1007000, view: 'city' },
  H: { bedrooms: 3, areaM2: 108, priceAt3: 1420000, view: 'city' },
};

export function priceFor(floor: number, stack: Stack): number {
  return STACK_META[stack].priceAt3 + 6500 * (floor - 3);
}

// Floor 20 and above, stacks C and D look at open harbour; below that the
// invented Calder House block partly blocks the view.
export function viewFor(floor: number, stack: Stack): ViewTag {
  const base = STACK_META[stack].view;
  if ((stack === 'C' || stack === 'D') && floor >= 20) return 'harbour';
  return base;
}

export const STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  held: 'Held',
  reserved: 'Reserved',
  withdrawn: 'Withdrawn',
  unreleased: 'Not released',
};

export const BAND_LABELS: Record<BandId, string> = {
  '03-09': 'Floors 3-9',
  '10-19': 'Floors 10-19',
  '20-29': 'Floors 20-29',
  '30-35': 'Floors 30-35',
  '36-38': 'Floors 36-38',
};

export const VIEW_LABELS: Record<ViewTag, string> = {
  harbour: 'Harbour',
  'harbour-partial': 'Harbour, partly blocked',
  park: 'Park',
  city: 'City',
  ridge: 'Ridge',
};

export const BEDROOM_LABELS: Record<string, string> = {
  '1': '1 bedroom',
  '2': '2 bedrooms',
  '3': '3 bedrooms',
};

export function chipName(field: FacetField, value: string): string {
  switch (field) {
    case 'bedrooms': return BEDROOM_LABELS[value] ?? value;
    case 'band': return BAND_LABELS[value as BandId] ?? value;
    case 'facing': return value;
    case 'view': return VIEW_LABELS[value as ViewTag] ?? value;
    case 'status': return STATUS_LABELS[value] ?? value;
  }
}

export function priceText(n: number): string {
  return n.toLocaleString('en-AU');
}

export function compareUnitCodes(a: string, b: string): number {
  const fa = codeFloor(a);
  const fb = codeFloor(b);
  if (fa !== fb) return fa - fb;
  return a.slice(-1) < b.slice(-1) ? -1 : a.slice(-1) === b.slice(-1) ? 0 : 1;
}
