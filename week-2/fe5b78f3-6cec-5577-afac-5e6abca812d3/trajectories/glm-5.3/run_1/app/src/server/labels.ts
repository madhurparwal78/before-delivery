import { AcceptCode, BerthType, WlType } from '../types.js';

// Status labels, decided in exactly one place.

export const statusLabel = {
  cnf(coach: string, berth: number, type: BerthType): string {
    return `CNF ${coach} ${berth} ${type}`;
  },
  racPending(): string {
    return 'RAC';
  },
  wl(type: WlType, n: number): string {
    return `${type} ${n}`;
  },
};

export function labelFor(p: {
  status: string; wl_type?: string | null; wl_num?: number | null; rac_place?: number | null;
  coach?: string | null; berth?: number | null; berth_type?: string | null;
}): string {
  if (p.status === 'CNF') return `CNF ${p.coach} ${p.berth} ${p.berth_type}`;
  if (p.status === 'RAC') return `RAC ${p.rac_place} ${p.coach} ${p.berth} SL`;
  if (p.status === 'NOSB') return 'NOSB';
  if (p.status === 'CAN') return 'CAN';
  if (p.status === 'CHART_NOT_CONFIRMED') return 'NOT CNF';
  return `${p.status} ${p.wl_num}`;
}

/** Rank for comparing statuses: CNF best, then RAC, then any waiting list. */
export const STATUS_RANK: Record<string, number> = {
  CNF: 3, RAC: 2, GNWL: 1, RLWL: 1, PQWL: 1, TQWL: 1, NOSB: 3,
};

export function worstAcceptOf(statuses: string[]): AcceptCode {
  let worst: AcceptCode = 'CNF';
  for (const s of statuses) {
    if (STATUS_RANK[s] === 1) worst = 'WL';
    else if (STATUS_RANK[s] === 2 && worst === 'CNF') worst = 'RAC';
  }
  return worst;
}
