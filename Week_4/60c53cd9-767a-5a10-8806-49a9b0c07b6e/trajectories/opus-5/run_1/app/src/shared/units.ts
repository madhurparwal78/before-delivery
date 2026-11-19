/** The static shape of the Highwater tower: floors, stacks, floor bands and seed prices. */

export type BandId = '03-09' | '10-19' | '20-29' | '30-35' | '36-38';
export type StackLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export type ViewTag = 'harbour' | 'harbour-partial' | 'park' | 'city' | 'ridge';
export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface FloorBand {
  readonly id: BandId;
  readonly low: number;
  readonly high: number;
}

export const FLOOR_BANDS: readonly FloorBand[] = [
  { id: '03-09', low: 3, high: 9 },
  { id: '10-19', low: 10, high: 19 },
  { id: '20-29', low: 20, high: 29 },
  { id: '30-35', low: 30, high: 35 },
  { id: '36-38', low: 36, high: 38 },
];

export const LOWEST_FLOOR = 3;
export const HIGHEST_FLOOR = 38;

export interface StackSpec {
  readonly letter: StackLetter;
  /** The compass bearing the stack's window node is built to face in the floor-plate model. */
  readonly windowBearing: number;
  readonly bedrooms: 1 | 2 | 3;
  readonly areaM2: number;
  readonly floor3Price: number;
  readonly view: ViewTag | { readonly below20: ViewTag; readonly from20: ViewTag };
}

export const STACKS: readonly StackSpec[] = [
  { letter: 'A', windowBearing: 134, bedrooms: 2, areaM2: 78, floor3Price: 1020000, view: 'park' },
  { letter: 'B', windowBearing: 178, bedrooms: 2, areaM2: 74, floor3Price: 985000, view: 'park' },
  {
    letter: 'C',
    windowBearing: 214,
    bedrooms: 3,
    areaM2: 112,
    floor3Price: 1480000,
    view: { below20: 'harbour-partial', from20: 'harbour' },
  },
  {
    letter: 'D',
    windowBearing: 268,
    bedrooms: 2,
    areaM2: 71,
    floor3Price: 930000,
    view: { below20: 'harbour-partial', from20: 'harbour' },
  },
  { letter: 'E', windowBearing: 311, bedrooms: 1, areaM2: 52, floor3Price: 690000, view: 'ridge' },
  { letter: 'F', windowBearing: 4, bedrooms: 1, areaM2: 49, floor3Price: 655000, view: 'ridge' },
  { letter: 'G', windowBearing: 41, bedrooms: 2, areaM2: 76, floor3Price: 1007000, view: 'city' },
  { letter: 'H', windowBearing: 93, bedrooms: 3, areaM2: 108, floor3Price: 1420000, view: 'city' },
];

export const STACK_LETTERS: readonly StackLetter[] = STACKS.map((s) => s.letter);

export const PRICE_STEP_PER_FLOOR = 6500;

export function stackSpec(letter: StackLetter): StackSpec {
  const spec = STACKS.find((s) => s.letter === letter);
  if (!spec) throw new Error(`unknown stack ${letter}`);
  return spec;
}

export function unitCode(floor: number, stack: StackLetter): string {
  return `${floor}${stack}`;
}

export function bandForFloor(floor: number): BandId {
  const band = FLOOR_BANDS.find((b) => floor >= b.low && floor <= b.high);
  if (!band) throw new Error(`floor ${floor} is outside the tower`);
  return band.id;
}

export function seedPrice(stack: StackLetter, floor: number): number {
  return stackSpec(stack).floor3Price + PRICE_STEP_PER_FLOOR * (floor - LOWEST_FLOOR);
}

export function viewTagFor(stack: StackLetter, floor: number): ViewTag {
  const view = stackSpec(stack).view;
  if (typeof view === 'string') return view;
  return floor >= 20 ? view.from20 : view.below20;
}

/** Every unit code in tower order: floor ascending, then stack letter. */
export function allUnitPositions(): { floor: number; stack: StackLetter; code: string }[] {
  const out: { floor: number; stack: StackLetter; code: string }[] = [];
  for (let floor = LOWEST_FLOOR; floor <= HIGHEST_FLOOR; floor += 1) {
    for (const stack of STACK_LETTERS) out.push({ floor, stack, code: unitCode(floor, stack) });
  }
  return out;
}

export function parseUnitCode(code: string): { floor: number; stack: StackLetter } | null {
  const match = /^([1-9][0-9]?)([A-H])$/.exec(code);
  if (!match) return null;
  const floor = Number(match[1]);
  if (floor < LOWEST_FLOOR || floor > HIGHEST_FLOOR) return null;
  return { floor, stack: match[2] as StackLetter };
}

/** Sort key for unit codes: floor number ascending, then stack letter. */
export function compareUnitCodes(a: string, b: string): number {
  const pa = parseUnitCode(a);
  const pb = parseUnitCode(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.floor !== pb.floor) return pa.floor - pb.floor;
  return pa.stack.localeCompare(pb.stack);
}
