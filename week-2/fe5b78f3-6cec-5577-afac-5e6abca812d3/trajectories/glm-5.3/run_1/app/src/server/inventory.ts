import type { PoolClient } from 'pg';
import {
  ClassCode, Gender, QuotaCode, WlType, AcceptCode, PassengerState,
  BerthPref, BerthType, BerthQuota,
} from '../types.js';
import { meetsSeniorCriteria } from '../types.js';
import { RunContext, wlTypeForStop } from '../seed.js';
import {
  berthQuota, berthType, isLower, wlCap, BERTHS_PER_COACH,
} from '../berth.js';

// The allotment order, the waiting-list cap, the availability counts and the
// promotion order are each decided in exactly one place: this file.

export interface HoldRow {
  coach: string; berth: number; place: number; pnr: string; passenger: number;
  from_idx: number; to_idx: number;
}

export interface QueueRow {
  pnr: string; passenger: number; wl_type: WlType; from_idx: number; to_idx: number; seq: string;
}

export interface RacRow {
  pnr: string; passenger: number; from_idx: number; to_idx: number; seq: string;
}

export interface RunInventory {
  coaches: string[]; // coach codes of this class
  holds: HoldRow[];
  rac: RacRow[];
  queues: QueueRow[];
}

export function stretchesOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && bFrom < aTo;
}

export function holdCovers(hold: { from_idx: number; to_idx: number }, from: number, to: number): boolean {
  return hold.from_idx <= from && to <= hold.to_idx;
}

async function loadHolds(c: PoolClient, train: string, runDate: string, cls: ClassCode) {
  const r = await c.query(
    `SELECT h.coach, h.berth, h.place, h.pnr, h.passenger, h.from_idx, h.to_idx
     FROM holds h JOIN coaches co ON co.train = h.train AND co.coach = h.coach
     WHERE h.train = $1 AND h.run_date = $2 AND co.cls = $3`,
    [train, runDate, cls],
  );
  return r.rows as unknown as HoldRow[];
}

export async function loadInventory(c: PoolClient, rc: RunContext, cls: ClassCode): Promise<RunInventory> {
  const coaches = rc.train.coaches.filter((x) => x.cls === cls).map((x) => x.code);
  const holds = await loadHolds(c, rc.train.number, iso(rc.runDateMs), cls);
  const racR = await c.query(
    `SELECT p.pnr, p.number AS passenger, p.from_idx, p.to_idx, p.seq::text AS seq
     FROM passengers p JOIN bookings b ON b.pnr = p.pnr
     WHERE b.train = $1 AND b.run_date = $2 AND b.cls = $3 AND p.status = 'RAC'
     ORDER BY p.seq`,
    [rc.train.number, iso(rc.runDateMs), cls],
  );
  const qR = await c.query(
    `SELECT p.pnr, p.number AS passenger, p.wl_type, p.from_idx, p.to_idx, p.seq::text AS seq
     FROM passengers p JOIN bookings b ON b.pnr = p.pnr
     WHERE b.train = $1 AND b.run_date = $2 AND b.cls = $3
       AND p.status IN ('GNWL','RLWL','PQWL','TQWL')
     ORDER BY p.seq`,
    [rc.train.number, iso(rc.runDateMs), cls],
  );
  return { coaches, holds, rac: racR.rows as unknown as RacRow[], queues: qR.rows as unknown as QueueRow[] };
}

function iso(ms: number): string {
  const { istDate } = require('../time.js') as typeof import('../time.js');
  return istDate(ms);
}

function berthIntervals(inv: RunInventory, coach: string, berth: number): { from: number; to: number }[] {
  return inv.holds
    .filter((h) => h.coach === coach && h.berth === berth)
    .map((h) => ({ from: h.from_idx, to: h.to_idx }));
}

function berthFreeOver(inv: RunInventory, coach: string, berth: number, from: number, to: number): boolean {
  return !berthIntervals(inv, coach, berth).some((iv) => stretchesOverlap(iv.from, iv.to, from, to));
}

function racPlaceFreeOver(inv: RunInventory, coach: string, berth: number, place: number, from: number, to: number): boolean {
  // the RAC hold lives on the passenger row, so consult rac holds from the holds table too
  return !inv.holds
    .filter((h) => h.coach === coach && h.berth === berth && h.place === place)
    .some((h) => stretchesOverlap(h.from_idx, h.to_idx, from, to));
}

export function poolOf(quota: QuotaCode): BerthQuota {
  return quota === 'GN' ? 'GN' : quota;
}

export interface AvailCounts {
  avl: number; rac: number; wl: number; wlCap: number; wlType: WlType | null;
}

/** Availability counts, recomputed from the actual holds. */
export function availCounts(inv: RunInventory, rc: RunContext, cls: ClassCode, quota: QuotaCode, from: number, to: number): AvailCounts {
  const pool = poolOf(quota);
  let avl = 0;
  for (const coach of inv.coaches) {
    for (let b = 1; b <= BERTHS_PER_COACH; b++) {
      if (berthQuota(b) !== pool) continue;
      if (berthFreeOver(inv, coach, b, from, to)) avl++;
    }
  }
  if (quota === 'GN') {
    let rac = 0;
    for (const coach of inv.coaches) {
      for (let b = 1; b <= BERTHS_PER_COACH; b++) {
        if (berthQuota(b) !== 'RAC') continue;
        for (const place of [1, 2]) {
          if (racPlaceFreeOver(inv, coach, b, place, from, to)) rac++;
        }
      }
    }
    const genWl = inv.queues.filter((q) => q.wl_type !== 'TQWL').length;
    const gnPoolBerths = inv.coaches.length * 42;
    return { avl, rac, wl: genWl, wlCap: wlCap(cls, gnPoolBerths), wlType: null };
  }
  if (quota === 'TQ') {
    const tqWl = inv.queues.filter((q) => q.wl_type === 'TQWL').length;
    const tqPoolBerths = inv.coaches.length * 12;
    return { avl, rac: 0, wl: tqWl, wlCap: wlCap(cls, tqPoolBerths), wlType: 'TQWL' };
  }
  return { avl, rac: 0, wl: 0, wlCap: 0, wlType: null };
}

/** The waiting-list type a booking joins, by From stop. */
export function bookingWlType(rc: RunContext, fromCode: string): WlType {
  return wlTypeForStop(rc.train, fromCode);
}

export interface AllotPassenger {
  name: string; age: number; gender: Gender; pref: BerthPref;
}

export interface AllotResult {
  passenger: AllotPassenger;
  outcome:
    | { kind: 'CNF'; coach: string; berth: number; berthType: BerthType }
    | { kind: 'RAC'; coach: string; berth: number; place: 1 | 2 }
    | { kind: 'WL'; wlType: WlType };
}

export interface AllotPlan {
  results: AllotResult[];
  /** 409 outcomes in the order quota_full, waitlist_full, party_split, no_lower_berth */
  outcome409: null | 'quota_full' | 'waitlist_full' | 'party_split' | 'no_lower_berth';
  /** The worst status any passenger would get, for availability_changed. */
  worst: AcceptCode;
}

function coachRoom(inv: RunInventory, coach: string, pool: BerthQuota, from: number, to: number, seniors: number, quota: QuotaCode): number {
  let room = 0;
  for (let b = 1; b <= BERTHS_PER_COACH; b++) {
    if (berthQuota(b) !== pool) continue;
    if (berthFreeOver(inv, coach, b, from, to)) room++;
  }
  if (quota === 'GN' && seniors > 0) {
    let ssRoom = 0;
    for (let b = 1; b <= BERTHS_PER_COACH; b++) {
      if (berthQuota(b) !== 'SS') continue;
      if (berthFreeOver(inv, coach, b, from, to)) ssRoom++;
      if (ssRoom >= seniors) break;
    }
    room += Math.min(ssRoom, seniors);
  }
  return room;
}

function lowestFreePoolBerth(inv: RunInventory, coach: string, pool: BerthQuota, from: number, to: number, pref: BerthPref): number | null {
  const wantType = pref === 'NONE' ? null : pref;
  let best: number | null = null;
  for (let b = 1; b <= BERTHS_PER_COACH; b++) {
    if (berthQuota(b) !== pool) continue;
    if (wantType && berthType(b) !== wantType) continue;
    if (berthFreeOver(inv, coach, b, from, to)) { best = b; break; }
  }
  if (best === null && wantType !== null) {
    for (let b = 1; b <= BERTHS_PER_COACH; b++) {
      if (berthQuota(b) !== pool) continue;
      if (berthFreeOver(inv, coach, b, from, to)) { best = b; break; }
    }
  }
  return best;
}

function lowestFreeSeniorBerth(inv: RunInventory, coach: string, from: number, to: number): number | null {
  for (let b = 1; b <= BERTHS_PER_COACH; b++) {
    if (berthQuota(b) !== 'SS') continue;
    if (berthFreeOver(inv, coach, b, from, to)) return b;
  }
  return null;
}

function nextRacPlace(inv: RunInventory, from: number, to: number): { coach: string; berth: number; place: 1 | 2 } | null {
  for (const coach of inv.coaches) {
    for (let b = 1; b <= BERTHS_PER_COACH; b++) {
      if (berthQuota(b) !== 'RAC') continue;
      for (const place of [1, 2] as const) {
        if (racPlaceFreeOver(inv, coach, b, place, from, to)) return { coach, berth: b, place };
      }
    }
  }
  return null;
}

export function planAllotment(
  inv: RunInventory, rc: RunContext, cls: ClassCode, quota: QuotaCode,
  from: number, to: number, passengers: AllotPassenger[],
  keepInOneCoach: boolean, lowerBerthOnly: boolean,
): AllotPlan {
  const pool = poolOf(quota);
  const paying = passengers.filter((p) => p.age >= 5);
  const seniors = quota === 'GN' ? paying.filter((p) => meetsSeniorCriteria(p.age, p.gender)).length : 0;
  const results: AllotResult[] = [];
  // Working copies so later passengers see earlier ones, and the caller's
  // inventory is never mutated.
  const holds = inv.holds.map((h) => ({ ...h }));
  const queues = inv.queues.map((q) => ({ ...q }));
  const working: RunInventory = { ...inv, holds, queues };

  // 1. The party's coach.
  let partyCoach: string | null = null;
  for (const coach of working.coaches) {
    if (coachRoom(working, coach, pool, from, to, seniors, quota) >= paying.length) { partyCoach = coach; break; }
  }
  if (partyCoach === null) {
    for (const coach of working.coaches) {
      if (coachRoom(working, coach, pool, from, to, seniors, quota) > 0) { partyCoach = coach; break; }
    }
  }

  const wlType = quota === 'TQ' ? 'TQWL' : bookingWlType(rc, rc.stops[from].code);
  const genWlCount = () => working.queues.filter((q) => q.wl_type !== 'TQWL').length;
  const tqWlCount = () => working.queues.filter((q) => q.wl_type === 'TQWL').length;
  const genCap = quota === 'GN' ? wlCap(cls, working.coaches.length * 42) : 0;
  const tqCap = quota === 'TQ' ? wlCap(cls, working.coaches.length * 12) : 0;

  const takeBerth = (coach: string, berth: number) => {
    holds.push({ coach, berth, place: 0, pnr: '', passenger: 0, from_idx: from, to_idx: to });
  };

  for (const p of paying) {
    const senior = quota === 'GN' && meetsSeniorCriteria(p.age, p.gender);
    let placed: AllotResult | null = null;
    if (pool === 'GN' || pool === 'TQ') {
      if (senior && partyCoach) {
        const b = lowestFreeSeniorBerth(working, partyCoach, from, to);
        if (b !== null) {
          placed = { passenger: p, outcome: { kind: 'CNF', coach: partyCoach, berth: b, berthType: berthType(b) } };
          takeBerth(partyCoach, b);
        }
      }
      if (!placed && senior && !keepInOneCoach) {
        // a Senior-quota lower berth in the lowest-numbered coach that has one
        for (const coach of working.coaches) {
          const b = lowestFreeSeniorBerth(working, coach, from, to);
          if (b !== null) {
            placed = { passenger: p, outcome: { kind: 'CNF', coach, berth: b, berthType: berthType(b) } };
            takeBerth(coach, b);
            break;
          }
        }
      }
      if (!placed && partyCoach) {
        const b = lowestFreePoolBerth(working, partyCoach, pool, from, to, p.pref);
        if (b !== null) {
          placed = { passenger: p, outcome: { kind: 'CNF', coach: partyCoach, berth: b, berthType: berthType(b) } };
          takeBerth(partyCoach, b);
        }
      }
      if (!placed) {
        for (const coach of working.coaches) {
          if (coach === partyCoach) continue;
          const b = lowestFreePoolBerth(working, coach, pool, from, to, p.pref);
          if (b !== null) {
            placed = { passenger: p, outcome: { kind: 'CNF', coach, berth: b, berthType: berthType(b) } };
            takeBerth(coach, b);
            break;
          }
        }
      }
      if (!placed && quota === 'GN') {
        const place = nextRacPlace(working, from, to);
        if (place) {
          placed = { passenger: p, outcome: { kind: 'RAC', ...place } };
          holds.push({ coach: place.coach, berth: place.berth, place: place.place, pnr: '', passenger: 0, from_idx: from, to_idx: to });
        }
      }
      if (!placed) {
        const isTq = quota === 'TQ';
        const count = isTq ? tqWlCount() : genWlCount();
        const cap = isTq ? tqCap : genCap;
        if (count + 1 > cap) {
          return { results: [], outcome409: 'waitlist_full', worst: 'WL' };
        }
        working.queues.push({ pnr: '', passenger: 0, wl_type: wlType, from_idx: from, to_idx: to, seq: String(working.queues.length + 1) });
        placed = { passenger: p, outcome: { kind: 'WL', wlType } };
      }
    } else {
      // Ladies and Senior quotas: own pool only, no RAC and no waiting list.
      for (const coach of working.coaches) {
        const b = lowestFreePoolBerth(working, coach, pool, from, to, p.pref);
        if (b !== null) {
          placed = { passenger: p, outcome: { kind: 'CNF', coach, berth: b, berthType: berthType(b) } };
          takeBerth(coach, b);
          break;
        }
      }
      if (!placed) {
        return { results: [], outcome409: 'quota_full', worst: 'CNF' };
      }
    }
    results.push(placed);
  }

  // 2. Options and acceptance.
  if (keepInOneCoach) {
    const coaches = new Set(results.filter((r) => r.outcome.kind === 'CNF').map((r) => (r.outcome as { coach: string }).coach));
    if (coaches.size > 1 || (paying.length > 0 && coaches.size === 0)) {
      return { results: [], outcome409: 'party_split', worst: 'CNF' };
    }
  }
  if (lowerBerthOnly) {
    const hasLower = results.some((r) => r.outcome.kind === 'CNF' && isLower((r.outcome as { berth: number }).berth));
    if (!hasLower) {
      return { results: [], outcome409: 'no_lower_berth', worst: 'CNF' };
    }
  }
  let worst: AcceptCode = 'CNF';
  for (const r of results) {
    if (r.outcome.kind === 'WL') worst = 'WL';
    else if (r.outcome.kind === 'RAC' && worst === 'CNF') worst = 'RAC';
  }
  return { results, outcome409: null, worst };
}
