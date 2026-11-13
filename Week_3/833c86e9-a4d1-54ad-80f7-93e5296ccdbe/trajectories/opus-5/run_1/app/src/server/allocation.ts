import { Inventory, RoomTypeRow, roomsLeft, stayDates } from './inventory';
import { StayContext, priceRoomNight } from './pricing';
import { nightOf } from './inventory';
import { checkStay } from './restrictions';
import { StayRequest } from './restrictions';

export interface Party {
  adults: number;
  ages: number[];
}

export interface Placement {
  room_type: string;
  adults: number;
  ages: number[];
}

export interface Allocation {
  rooms: Placement[];
  total_minor: number;
}

export type RoomAdvice =
  | { code: 'capacity'; n: number; m: number }
  | { code: 'adult'; n: number }
  | { code: 'left'; n: number; room_type: string };

const MAX_ROOMS = 4;
const BANDS = [0, 1, 2] as const;

function bandOf(age: number): 0 | 1 | 2 {
  if (age <= 2) return 0;
  if (age <= 11) return 1;
  return 2;
}

function bandCounts(ages: number[]): [number, number, number] {
  const counts: [number, number, number] = [0, 0, 0];
  for (const age of ages) counts[bandOf(age)] += 1;
  return counts;
}

function agesOfBand(ages: number[], band: 0 | 1 | 2): number[] {
  return ages.filter((age) => bandOf(age) === band);
}

interface RoomShape {
  adults: number;
  bands: [number, number, number];
}

function roomCostKey(type: string, shape: RoomShape): string {
  return `${type}|${shape.adults}|${shape.bands.join(',')}`;
}

/** The lowest number of rooms left of a type over every night of the stay. */
export function leftOverStay(inv: Inventory, roomType: string, inDate: string, outDate: string): number {
  let left = Number.POSITIVE_INFINITY;
  for (const date of stayDates(inDate, outDate)) left = Math.min(left, roomsLeft(inv, roomType, date));
  return left === Number.POSITIVE_INFINITY ? 0 : left;
}

function roomCost(
  ctx: StayContext,
  inv: Inventory,
  rt: RoomTypeRow,
  shape: RoomShape,
  memo: Map<string, number>,
): number {
  const key = roomCostKey(rt.code, shape);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const ages: number[] = [];
  for (let i = 0; i < shape.bands[0]; i++) ages.push(1);
  for (let i = 0; i < shape.bands[1]; i++) ages.push(7);
  for (let i = 0; i < shape.bands[2]; i++) ages.push(14);
  let total = 0;
  for (const date of stayDates(ctx.inDate, ctx.outDate)) {
    const night = nightOf(inv, rt.code, date);
    if (!night) return Number.POSITIVE_INFINITY;
    total += priceRoomNight(ctx, rt, night, {
      room_type: rt.code,
      plan: 'refundable',
      breakfast: false,
      adults: shape.adults,
      ages,
    }).total_minor;
  }
  memo.set(key, total);
  return total;
}

interface Candidate {
  codes: string[];
  shapes: RoomShape[];
  total: number;
}

function better(a: Candidate, b: Candidate): boolean {
  if (a.total !== b.total) return a.total < b.total;
  if (a.codes.length !== b.codes.length) return a.codes.length < b.codes.length;
  for (let i = 0; i < a.codes.length; i++) {
    if (a.codes[i] !== b.codes[i]) return a.codes[i] < b.codes[i];
  }
  for (let i = 0; i < a.shapes.length; i++) {
    if (a.shapes[i].adults !== b.shapes[i].adults) return a.shapes[i].adults > b.shapes[i].adults;
  }
  for (const band of [2, 1, 0] as const) {
    for (let i = 0; i < a.shapes.length; i++) {
      if (a.shapes[i].bands[band] !== b.shapes[i].bands[band]) {
        return a.shapes[i].bands[band] > b.shapes[i].bands[band];
      }
    }
  }
  return false;
}

/** Every placement of the party into a fixed multiset of room types. */
function placements(
  types: RoomTypeRow[],
  party: Party,
  visit: (shapes: RoomShape[]) => void,
): void {
  const bands = bandCounts(party.ages);
  const shapes: RoomShape[] = [];
  const capacityFrom = (index: number): number =>
    types.slice(index).reduce((sum, t) => sum + t.max_guests, 0);

  const recurse = (index: number, adultsLeft: number, bandsLeft: [number, number, number]): void => {
    const childrenLeft = bandsLeft[0] + bandsLeft[1] + bandsLeft[2];
    if (index === types.length) {
      if (adultsLeft === 0 && childrenLeft === 0) visit(shapes.map((s) => ({ adults: s.adults, bands: [...s.bands] as [number, number, number] })));
      return;
    }
    const roomsAfter = types.length - index - 1;
    if (adultsLeft + childrenLeft > capacityFrom(index)) return;
    const rt = types[index];
    const maxAdults = Math.min(rt.max_adults, adultsLeft - roomsAfter);
    for (let adults = 1; adults <= maxAdults; adults++) {
      const room: RoomShape = { adults, bands: [0, 0, 0] };
      shapes.push(room);
      const slots = rt.max_guests - adults;
      for (let b0 = 0; b0 <= Math.min(bandsLeft[0], slots); b0++) {
        for (let b1 = 0; b1 <= Math.min(bandsLeft[1], slots - b0); b1++) {
          for (let b2 = 0; b2 <= Math.min(bandsLeft[2], slots - b0 - b1); b2++) {
            room.bands = [b0, b1, b2];
            recurse(index + 1, adultsLeft - adults, [
              bandsLeft[0] - b0,
              bandsLeft[1] - b1,
              bandsLeft[2] - b2,
            ]);
          }
        }
      }
      shapes.pop();
    }
  };
  recurse(0, party.adults, bands);
}

function toPlacements(codes: string[], shapes: RoomShape[], party: Party): Placement[] {
  const pools: Record<0 | 1 | 2, number[]> = {
    0: agesOfBand(party.ages, 0),
    1: agesOfBand(party.ages, 1),
    2: agesOfBand(party.ages, 2),
  };
  const cursors = { 0: 0, 1: 0, 2: 0 };
  return codes.map((code, index) => {
    const shape = shapes[index];
    const ages: number[] = [];
    for (const band of BANDS) {
      for (let i = 0; i < shape.bands[band]; i++) {
        ages.push(pools[band][cursors[band]]);
        cursors[band] += 1;
      }
    }
    return { room_type: code, adults: shape.adults, ages };
  });
}

function combos(types: RoomTypeRow[], limits: Map<string, number>): string[][] {
  const out: string[][] = [];
  const codes = types.map((t) => t.code);
  const build = (start: number, current: string[]): void => {
    if (current.length > 0) out.push([...current]);
    if (current.length === MAX_ROOMS) return;
    for (let i = start; i < codes.length; i++) {
      const code = codes[i];
      const used = current.filter((c) => c === code).length;
      if (used + 1 > (limits.get(code) ?? 0)) continue;
      current.push(code);
      build(i, current);
      current.pop();
    }
  };
  build(0, []);
  return out;
}

export interface AllocationInput {
  ctx: StayContext;
  inv: Inventory;
  types: RoomTypeRow[];
  party: Party;
  req: StayRequest;
}

/** The cheapest room combination for the party, by the published rule. */
export function recommend(input: AllocationInput): Allocation | null {
  const { ctx, inv, types, party, req } = input;
  const limits = new Map<string, number>();
  for (const rt of types) limits.set(rt.code, leftOverStay(inv, rt.code, ctx.inDate, ctx.outDate));
  const memo = new Map<string, number>();
  let best: Candidate | null = null;
  for (const codes of combos(types, limits)) {
    const counts = new Map<string, number>();
    for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
    let allowed = true;
    for (const [code, count] of counts) {
      if (checkStay(inv, code, count, req) !== null) {
        allowed = false;
        break;
      }
    }
    if (!allowed) continue;
    const comboTypes = codes.map((code) => types.find((t) => t.code === code)!);
    placements(comboTypes, party, (shapes) => {
      let total = 0;
      for (let i = 0; i < comboTypes.length; i++) {
        total += roomCost(ctx, inv, comboTypes[i], shapes[i], memo);
        if (!Number.isFinite(total)) return;
      }
      const candidate: Candidate = { codes, shapes, total };
      if (best === null || better(candidate, best)) best = candidate;
    });
  }
  if (best === null) return null;
  const winner: Candidate = best;
  return { rooms: toPlacements(winner.codes, winner.shapes, party), total_minor: winner.total };
}

/** Places the party in the chosen room counts, or returns the published advice. */
export function placeOverride(
  input: AllocationInput,
  counts: Map<string, number>,
): { allocation: Allocation } | { advice: RoomAdvice } {
  const { ctx, inv, types, party } = input;
  const codes: string[] = [];
  for (const rt of types) {
    const count = counts.get(rt.code) ?? 0;
    for (let i = 0; i < count; i++) codes.push(rt.code);
  }
  const partySize = party.adults + party.ages.length;
  const comboTypes = codes.map((code) => types.find((t) => t.code === code)!);
  const capacity = comboTypes.reduce((sum, t) => sum + t.max_guests, 0);
  if (capacity < partySize) return { advice: { code: 'capacity', n: capacity, m: partySize } };
  if (codes.length > party.adults) return { advice: { code: 'adult', n: codes.length } };
  for (const [code, count] of counts) {
    if (count <= 0) continue;
    const left = leftOverStay(inv, code, ctx.inDate, ctx.outDate);
    if (left < count) return { advice: { code: 'left', n: left, room_type: code } };
  }
  const memo = new Map<string, number>();
  let best: Candidate | null = null;
  placements(comboTypes, party, (shapes) => {
    let total = 0;
    for (let i = 0; i < comboTypes.length; i++) {
      total += roomCost(ctx, inv, comboTypes[i], shapes[i], memo);
      if (!Number.isFinite(total)) return;
    }
    const candidate: Candidate = { codes, shapes, total };
    if (best === null || better(candidate, best)) best = candidate;
  });
  if (best === null) return { advice: { code: 'capacity', n: capacity, m: partySize } };
  const winner: Candidate = best;
  return { allocation: { rooms: toPlacements(winner.codes, winner.shapes, party), total_minor: winner.total } };
}
