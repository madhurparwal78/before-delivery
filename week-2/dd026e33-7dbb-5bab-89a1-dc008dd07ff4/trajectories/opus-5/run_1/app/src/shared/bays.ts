import type { BayClass } from './types';

/** Published clearance: a bay must exceed the car by this much in length and width. */
export const CLEARANCE_MM = 500;

export interface CarSize {
  readonly length_mm: number;
  readonly width_mm: number;
}

export interface BaySize {
  readonly length_mm: number;
  readonly width_mm: number;
}

/** The single decision on whether a car fits a bay. */
export function carFitsBay(car: CarSize, bay: BaySize): boolean {
  return car.length_mm + CLEARANCE_MM <= bay.length_mm && car.width_mm + CLEARANCE_MM <= bay.width_mm;
}

export type BayIneligibility = 'occupied' | 'class_change' | 'too_small';

export interface BayCandidate {
  readonly length_mm: number;
  readonly width_mm: number;
  readonly class: BayClass;
  readonly occupiedByCarId: string | null;
}

/** A bay reports one reason, in the published order. */
export function bayIneligibility(
  car: CarSize & { readonly id: string; readonly bayClass: BayClass | null },
  bay: BayCandidate,
): BayIneligibility | null {
  if (bay.occupiedByCarId !== null) return 'occupied';
  if (car.bayClass !== null && bay.class !== car.bayClass) return 'class_change';
  if (!carFitsBay(car, bay)) return 'too_small';
  return null;
}

export const BAY_PLAN: Record<BayClass, { product: string; plan: string; price: string }> = {
  standard: { product: 'bay-standard', plan: 'bay-standard-monthly', price: '480.00' },
  covered_lift: { product: 'bay-covered-lift', plan: 'bay-covered-lift-monthly', price: '690.00' },
  sealed_capsule: {
    product: 'bay-sealed-capsule',
    plan: 'bay-sealed-capsule-monthly',
    price: '950.00',
  },
};
