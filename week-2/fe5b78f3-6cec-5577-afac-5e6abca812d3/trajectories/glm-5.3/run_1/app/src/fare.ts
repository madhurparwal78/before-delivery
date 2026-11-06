import { ClassCode, Gender } from './types.js';
import { roundHalfUp } from './money.js';

// The fare, decided in exactly one place.

export const CLASS_RATES: Record<ClassCode, { perKmPaise: number; reservationPaise: number; tatkalPaise: number }> = {
  SL: { perKmPaise: 45, reservationPaise: 2000, tatkalPaise: 15000 },
  '3A': { perKmPaise: 120, reservationPaise: 4000, tatkalPaise: 40000 },
};

/** Per-passenger fare in paise, GST excluded. */
export function fareBeforeGstPaise(km: number, cls: ClassCode, tatkal: boolean): number {
  const r = CLASS_RATES[cls];
  const baseRaw = km * r.perKmPaise;
  const base = Math.ceil(baseRaw / 500) * 500; // rounded up to the next whole ₹5
  return base + r.reservationPaise + (tatkal ? r.tatkalPaise : 0);
}

/** GST on 3A: 5% of the fare before GST; always whole paise. */
export function gstOnFarePaise(fareBeforeGst: number, cls: ClassCode): number {
  if (cls !== '3A') return 0;
  return Math.round(fareBeforeGst * 0.05);
}

/** A passenger's whole fare, GST included. */
export function farePaise(km: number, cls: ClassCode, tatkal: boolean): number {
  const before = fareBeforeGstPaise(km, cls, tatkal);
  return before + gstOnFarePaise(before, cls);
}

/** GST on a cancellation charge: 5% on 3A, rounded half up once per passenger. */
export function gstOnChargePaise(charge: number, cls: ClassCode): number {
  if (cls !== '3A') return 0;
  return roundHalfUp(charge * 0.05);
}

export function genderOk(g: string): g is Gender {
  return g === 'M' || g === 'F' || g === 'T';
}
