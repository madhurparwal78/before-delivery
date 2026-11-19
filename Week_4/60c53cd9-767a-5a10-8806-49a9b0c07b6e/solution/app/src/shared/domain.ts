/** Domain vocabulary shared by the server and the browser: the tower, its stacks, floor bands and unit codes. */

export const TOP_FLOOR = 38;
export const BOTTOM_FLOOR = 3;
export const STACK_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type StackLetter = (typeof STACK_LETTERS)[number];

export const BANDS = ["03-09", "10-19", "20-29", "30-35", "36-38"] as const;
export type Band = (typeof BANDS)[number];

export const FACINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
type Facing = (typeof FACINGS)[number];

export const VIEW_TAGS = ["harbour", "harbour-partial", "park", "city", "ridge"] as const;
export type ViewTag = (typeof VIEW_TAGS)[number];

export const STATUSES = ["available", "held", "reserved"] as const;
export type LiveStatus = (typeof STATUSES)[number];
export type CellStatus = LiveStatus | "withdrawn" | "unreleased";

export const BEDROOM_VALUES = ["1", "2", "3"] as const;

interface StackSpec {
  readonly letter: StackLetter;
  readonly bearing: number;
  readonly bedrooms: 1 | 2 | 3;
  readonly areaM2: number;
  readonly priceAtFloor3: number;
  readonly view: (floor: number) => ViewTag;
}

const harbourByHeight = (floor: number): ViewTag => (floor >= 20 ? "harbour" : "harbour-partial");

export const STACKS: Readonly<Record<StackLetter, StackSpec>> = {
  A: { letter: "A", bearing: 134, bedrooms: 2, areaM2: 78, priceAtFloor3: 1_020_000, view: () => "park" },
  B: { letter: "B", bearing: 178, bedrooms: 2, areaM2: 74, priceAtFloor3: 985_000, view: () => "park" },
  C: { letter: "C", bearing: 214, bedrooms: 3, areaM2: 112, priceAtFloor3: 1_480_000, view: harbourByHeight },
  D: { letter: "D", bearing: 268, bedrooms: 2, areaM2: 71, priceAtFloor3: 930_000, view: harbourByHeight },
  E: { letter: "E", bearing: 311, bedrooms: 1, areaM2: 52, priceAtFloor3: 690_000, view: () => "ridge" },
  F: { letter: "F", bearing: 4, bedrooms: 1, areaM2: 49, priceAtFloor3: 655_000, view: () => "ridge" },
  G: { letter: "G", bearing: 41, bedrooms: 2, areaM2: 76, priceAtFloor3: 1_007_000, view: () => "city" },
  H: { letter: "H", bearing: 93, bedrooms: 3, areaM2: 108, priceAtFloor3: 1_420_000, view: () => "city" },
};

const PRICE_STEP_PER_FLOOR = 6_500;

export const bandOf = (floor: number): Band => {
  if (floor >= 36) return "36-38";
  if (floor >= 30) return "30-35";
  if (floor >= 20) return "20-29";
  if (floor >= 10) return "10-19";
  return "03-09";
};

export const BAND_FLOORS: Readonly<Record<Band, readonly [number, number]>> = {
  "03-09": [3, 9],
  "10-19": [10, 19],
  "20-29": [20, 29],
  "30-35": [30, 35],
  "36-38": [36, 38],
};

export const unitCode = (floor: number, stack: StackLetter): string => `${floor}${stack}`;

export const seedPrice = (stack: StackLetter, floor: number): number =>
  STACKS[stack].priceAtFloor3 + PRICE_STEP_PER_FLOOR * (floor - BOTTOM_FLOOR);

/** The eight-point label for a whole-degree bearing, from 45-degree sectors centred on N. */
export const facingOf = (bearing: number): Facing => {
  const normalised = ((bearing % 360) + 360) % 360;
  return FACINGS[Math.floor((normalised + 22.5) / 45) % 8] as Facing;
};

interface UnitIdentity {
  readonly code: string;
  readonly floor: number;
  readonly stack: StackLetter;
}

export const parseUnitCode = (code: string): UnitIdentity | null => {
  const match = /^([1-9][0-9]?)([A-H])$/.exec(code);
  if (!match) return null;
  const floor = Number(match[1]);
  if (floor < BOTTOM_FLOOR || floor > TOP_FLOOR) return null;
  return { code, floor, stack: match[2] as StackLetter };
};

export const ALL_UNITS: readonly UnitIdentity[] = (() => {
  const units: UnitIdentity[] = [];
  for (let floor = BOTTOM_FLOOR; floor <= TOP_FLOOR; floor += 1) {
    for (const stack of STACK_LETTERS) units.push({ code: unitCode(floor, stack), floor, stack });
  }
  return units;
})();

export const BAND_LABEL: Readonly<Record<Band, string>> = {
  "03-09": "Floors 3-9",
  "10-19": "Floors 10-19",
  "20-29": "Floors 20-29",
  "30-35": "Floors 30-35",
  "36-38": "Floors 36-38",
};

export const VIEW_LABEL: Readonly<Record<ViewTag, string>> = {
  harbour: "Harbour",
  "harbour-partial": "Harbour, partly blocked",
  park: "Park",
  city: "City",
  ridge: "Ridge",
};

export const STATUS_LABEL: Readonly<Record<CellStatus, string>> = {
  available: "Available",
  held: "Held",
  reserved: "Reserved",
  withdrawn: "Withdrawn",
  unreleased: "Not released",
};

export const bedroomLabel = (bedrooms: number): string => (bedrooms === 1 ? "1 bedroom" : `${bedrooms} bedrooms`);
