/**
 * Bay fit and assignment reasons — the single decision place.
 */
export const BAY_CLEARANCE_MM = 500;

export type BayClass = 'standard' | 'covered_lift' | 'sealed_capsule';

export const BAY_CLASS_LABELS: Record<BayClass, string> = {
  standard: 'Standard',
  covered_lift: 'Covered lift',
  sealed_capsule: 'Sealed capsule',
};

export interface BayCheckInput {
  carLengthMm: number;
  carWidthMm: number;
  bayLengthMm: number;
  bayWidthMm: number;
  occupiedByCarId: string | null;
  carId: string;
  movingStoredCar: boolean;
  bayClass: BayClass;
  carCurrentBayClass: BayClass | null;
}

export type BayReason = 'bay_occupied' | 'bay_class_change' | 'bay_too_small';

/** The published reason order: occupied, then class change (moves only), then too small. */
export function bayRejectReason(input: BayCheckInput): BayReason | null {
  if (input.occupiedByCarId !== null && input.occupiedByCarId !== input.carId) {
    return 'bay_occupied';
  }
  if (input.movingStoredCar && input.carCurrentBayClass !== null && input.bayClass !== input.carCurrentBayClass) {
    return 'bay_class_change';
  }
  if (
    input.carLengthMm + BAY_CLEARANCE_MM > input.bayLengthMm ||
    input.carWidthMm + BAY_CLEARANCE_MM > input.bayWidthMm
  ) {
    return 'bay_too_small';
  }
  return null;
}

export function carFits(carLengthMm: number, carWidthMm: number, bayLengthMm: number, bayWidthMm: number): boolean {
  return (
    carLengthMm + BAY_CLEARANCE_MM <= bayLengthMm &&
    carWidthMm + BAY_CLEARANCE_MM <= bayWidthMm
  );
}
