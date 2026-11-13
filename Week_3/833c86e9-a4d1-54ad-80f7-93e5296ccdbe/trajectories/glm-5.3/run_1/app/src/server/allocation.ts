import type { NightInventory, Reason } from "../domain/restrictions.js";
import { checkStay } from "../domain/restrictions.js";

export type RoomTypeLite = {
  code: string;
  name: string;
  included_adults: number;
  max_adults: number;
  max_guests: number;
  extra_adult_minor: number;
  child_minor: number;
};

export type Party = { adults: number; ages: number[] };

export type PlacedRoom = { room_type: string; adults: number; ages: number[] };

export type Candidate = { rooms: PlacedRoom[]; total_minor: number };

export type AllocateResult =
  | { ok: true; best: Candidate | null }
  | { ok: false; advice: { code: "capacity" | "adult" | "left"; n: number; m?: number; room_type?: string } };

type Band = "b0" | "b3" | "b12";
const bandOf = (age: number): Band => (age <= 2 ? "b0" : age <= 11 ? "b3" : "b12");
const BAND_ORDER: Band[] = ["b12", "b3", "b0"];

/**
 * Enumerate multisets of up to 4 rooms with enough inventory and valid stays.
 * counts maps room type code to the number of rooms of that type.
 */
function enumerateRoomCounts(roomTypes: RoomTypeLite[], inv: Map<string, Map<string, NightInventory>>, nights: string[], today: string, party: Party): Map<string, number>[] {
  const out: Map<string, number>[] = [];
  const codes = [...roomTypes].sort((a, b) => a.code.localeCompare(b.code));
  const rec = (i: number, current: Map<string, number>) => {
    if (i === codes.length) {
      if (current.size > 0) out.push(new Map(current));
      return;
    }
    const rt = codes[i];
    const stayOk = checkStay({ in: nights[0], out: addOne(nights[nights.length - 1]), rooms: 1, nights, inv: inv.get(rt.code)!, today });
    const maxRooms = stayOk === null ? Math.min(4 - [...current.values()].reduce((s, x) => s + x, 0), 4) : 0;
    for (let n = 0; n <= maxRooms; n++) {
      if (n > 0) current.set(rt.code, n);
      rec(i + 1, current);
      if (n > 0) current.delete(rt.code);
    }
  };
  rec(0, new Map());
  return out;
}

function addOne(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * All placements of the party into the given room multiset. Children of one
 * band are assigned in input order to rooms in code order. Each room holds at
 * least one adult, at most max_adults and at most max_guests guests.
 */
function placements(counts: Map<string, number>, roomTypes: RoomTypeLite[], party: Party): PlacedRoom[][] {
  const slots: { code: string; rt: RoomTypeLite }[] = [];
  const codes = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  for (const code of codes) {
    const rt = roomTypes.find((r) => r.code === code)!;
    for (let i = 0; i < counts.get(code)!; i++) slots.push({ code, rt });
  }
  const results: PlacedRoom[][] = [];
  const adultsLeft = party.adults;
  const bands: Record<Band, number> = { b0: 0, b3: 0, b12: 0 };
  for (const a of party.ages) bands[bandOf(a)]++;
  // For each slot, choose adults then children per band. Enforce limits; at least one adult each.
  const adultsAssign = new Array<number>(slots.length).fill(0);
  const kidsAssign: Record<Band, number[]> = { b0: new Array(slots.length).fill(0), b3: new Array(slots.length).fill(0), b12: new Array(slots.length).fill(0) };

  const fits = (): boolean => {
    for (let i = 0; i < slots.length; i++) {
      const rt = slots[i].rt;
      const guests = adultsAssign[i] + kidsAssign.b0[i] + kidsAssign.b3[i] + kidsAssign.b12[i];
      if (guests > rt.max_guests) return false;
      if (adultsAssign[i] > rt.max_adults) return false;
    }
    return true;
  };

  const recAdults = (i: number, remaining: number) => {
    if (i === slots.length) {
      if (remaining !== 0) return;
      // children, band by band in the published order
      const recBand = (band: Band, idx: number, left: number, next: () => void): void => {
        if (band === "b12") {
          recBand("b3", 0, bands.b3, () => recBand("b0", 0, bands.b0, next));
          return;
        }
        if (band === "b3") {
          recBand("b0", 0, bands.b0, next);
          return;
        }
        if (!fits()) return;
        const rooms: PlacedRoom[] = slots.map((s, idx2) => ({
          room_type: s.code, adults: adultsAssign[idx2], ages: []
        }));
        results.push(rooms);
      };
      recBand("b12", 0, bands.b12, () => {
        if (!fits()) return;
        const rooms: PlacedRoom[] = slots.map((s, idx2) => ({ room_type: s.code, adults: adultsAssign[idx2], ages: [] }));
        results.push(rooms);
      });
      return;
    }
    const rt = slots[i].rt;
    const maxA = Math.min(rt.max_adults, rt.max_guests, remaining - (slots.length - i - 1));
    for (let a = 1; a <= maxA; a++) {
      adultsAssign[i] = a;
      recAdults(i + 1, remaining - a);
    }
    adultsAssign[i] = 0;
  };
  recAdults(0, adultsLeft);

  // Assign child ages in input order to rooms in code order for each band.
  const out: PlacedRoom[][] = [];
  for (const rooms of results) {
    const perRoomAges: number[][] = rooms.map(() => []);
    for (const band of BAND_ORDER) {
      const agesOfBand = party.ages.filter((a) => bandOf(a) === band);
      // rooms are in code order already (slots built in code order)
      for (const age of agesOfBand) {
        // first room with capacity for this band
        for (let i = 0; i < rooms.length; i++) {
          const rt = roomTypes.find((r) => r.code === rooms[i].room_type)!;
          const guests = rooms[i].adults + perRoomAges[i].length;
          if (guests < rt.max_guests) { perRoomAges[i].push(age); break; }
        }
      }
    }
    let ok = true;
    for (let i = 0; i < rooms.length && ok; i++) {
      rooms[i].ages = perRoomAges[i];
    }
    out.push(rooms);
  }
  return out;
}

export type PriceFn = (rooms: PlacedRoom[]) => number | null;

/**
 * The recommendation: the lowest stay total, ties to fewer rooms, then room
 * codes ascending, then placements with most adults in earlier rooms.
 */
export function recommend(roomTypes: RoomTypeLite[], inv: Map<string, Map<string, NightInventory>>, nights: string[], today: string, party: Party, price: PriceFn): AllocateResult {
  if (party.adults < 1) return { ok: false, advice: { code: "adult", n: 1 } };
  const countSets = enumerateRoomCounts(roomTypes, inv, nights, today, party);
  let best: Candidate | null = null;
  for (const counts of countSets) {
    const placementsList = placements(counts, roomTypes, party);
    for (const rooms of placementsList) {
      const total = price(rooms);
      if (total === null) continue;
      if (best === null) { best = { rooms, total_minor: total }; continue; }
      const cmp = compareCandidates({ rooms, total_minor: total }, best);
      if (cmp < 0) best = { rooms, total_minor: total };
    }
  }
  if (best === null) {
    // Distinguish advice: capacity, adults, or nothing bookable.
    return diagnose(roomTypes, inv, nights, today, party);
  }
  return { ok: true, best };
}

/** Compare two candidates by the published tie-break order. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.total_minor !== b.total_minor) return a.total_minor - b.total_minor;
  if (a.rooms.length !== b.rooms.length) return a.rooms.length - b.rooms.length;
  const acodes = a.rooms.map((r) => r.room_type).join(",");
  const bcodes = b.rooms.map((r) => r.room_type).join(",");
  if (acodes !== bcodes) return acodes.localeCompare(bcodes);
  const byRoom = (rooms: PlacedRoom[]) => {
    const m = new Map<string, PlacedRoom[]>();
    for (const r of rooms) {
      const list = m.get(r.room_type) ?? [];
      list.push(r);
      m.set(r.room_type, list);
    }
    for (const [, list] of m) list.sort((x, y) => y.adults - x.adults);
    return [...[...m.entries()].sort((x, y) => x[0].localeCompare(y[0]))].map(([, list]) => list);
  };
  const A = byRoom(a.rooms), B = byRoom(b.rooms);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    for (let j = 0; j < Math.min(A[i].length, B[i].length); j++) {
      if (A[i][j].adults !== B[i][j].adults) return B[i][j].adults - A[i][j].adults;
    }
  }
  const kidsOf = (rooms: PlacedRoom[], band: Band) => rooms.reduce((s, r) => s + r.ages.filter((a) => bandOf(a) === band).length, 0);
  for (const band of BAND_ORDER) {
    const ka = kidsOf(a.rooms, band), kb = kidsOf(b.rooms, band);
    if (ka !== kb) return kb - ka;
  }
  return 0;
}

function diagnose(roomTypes: RoomTypeLite[], inv: Map<string, Map<string, NightInventory>>, nights: string[], today: string, party: Party): AllocateResult {
  const size = party.adults + party.ages.length;
  // If any single night passes arrival with rooms left, capacity is the issue.
  let anyBookable = false;
  for (const rt of roomTypes) {
    const r: Reason | null = checkStay({ in: nights[0], out: addOne(nights[nights.length - 1]), rooms: 1, nights, inv: inv.get(rt.code)!, today });
    if (r === null) anyBookable = true;
  }
  if (!anyBookable) return { ok: false, advice: { code: "capacity", n: 0, m: size } };
  // Would 4 rooms fit?
  for (let n = 1; n <= 4; n++) {
    let cap = 0;
    for (const rt of roomTypes) {
      const left = inv.get(rt.code)?.get(nights[0])?.left ?? 0;
      if (left > 0) cap += rt.max_guests * Math.min(left, n);
    }
    if (cap >= size) {
      if (party.adults > n * Math.max(...roomTypes.map((r) => r.max_adults))) continue;
      return { ok: false, advice: { code: "capacity", n: cap, m: size } };
    }
  }
  return { ok: false, advice: { code: "capacity", n: 0, m: size } };
}

/** Validate an override (chosen room counts) and place the party, or give advice. */
export function placeOverride(counts: Record<string, number>, roomTypes: RoomTypeLite[], inv: Map<string, Map<string, NightInventory>>, nights: string[], today: string, party: Party, price: PriceFn): AllocateResult {
  const codes = Object.keys(counts).filter((k) => counts[k] > 0);
  const totalRooms = codes.reduce((s, k) => s + counts[k], 0);
  if (totalRooms > party.adults) return { ok: false, advice: { code: "adult", n: party.adults } };
  let capacity = 0;
  for (const code of codes) {
    const rt = roomTypes.find((r) => r.code === code);
    if (!rt) continue;
    capacity += rt.max_guests * counts[code];
  }
  if (capacity < party.adults + party.ages.length) {
    return { ok: false, advice: { code: "capacity", n: capacity, m: party.adults + party.ages.length } };
  }
  for (const code of codes) {
    const rt = roomTypes.find((r) => r.code === code);
    if (!rt) continue;
    let minLeft = Infinity;
    for (const date of nights) minLeft = Math.min(minLeft, inv.get(code)?.get(date)?.left ?? 0);
    if (minLeft < counts[code]) return { ok: false, advice: { code: "left", n: minLeft, room_type: rt.name } };
  }
  const countMap = new Map(Object.entries(counts).filter(([, v]) => v > 0) as [string, number][]);
  const list = placements(countMap, roomTypes, party);
  let best: Candidate | null = null;
  for (const rooms of list) {
    const total = price(rooms);
    if (total === null) continue;
    if (best === null || compareCandidates({ rooms, total_minor: total }, best) < 0) best = { rooms, total_minor: total };
  }
  if (best === null) return { ok: false, advice: { code: "capacity", n: capacity, m: party.adults + party.ages.length } };
  return { ok: true, best };
}
