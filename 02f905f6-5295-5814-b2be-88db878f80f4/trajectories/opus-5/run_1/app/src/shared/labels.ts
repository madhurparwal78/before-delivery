import type { Cone, FiringStatus, PieceStatus, Plan, Stage } from './types';

export const PIECE_STATUS_LABELS: Record<PieceStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  queued: 'Waiting for kiln',
  loaded: 'Loaded in kiln',
  firing: 'Firing',
  cooling: 'Kiln still cooling',
  unloadable: 'Cooled, waiting to unload',
  ready: 'Ready on pickup shelf',
  collected: 'Collected',
  uncollected: 'Uncollected',
};

export const FIRING_STATUS_LABELS: Record<FiringStatus, string> = {
  building: 'Building load',
  firing: 'Firing',
  cooling: 'Kiln still cooling',
  unloadable: 'Ready to unload',
  unloaded: 'Unloaded',
};

export const PLAN_LABELS: Record<Plan, string> = {
  bisque_and_glaze: 'Bisque and glaze',
  bisque_only: 'Bisque only',
  glaze_only: 'Glaze only',
};

/** Cones from coolest to hottest. */
export const CONE_ORDER: Cone[] = ['06', '04', '02', '6', '10'];

export function coneIndex(cone: Cone): number {
  return CONE_ORDER.indexOf(cone);
}

/** A clay is rated for a firing when the firing's cone is at or below the clay's max cone. */
export function clayRatedFor(maxCone: Cone, firingCone: Cone): boolean {
  return coneIndex(firingCone) <= coneIndex(maxCone);
}

/** A cone glyph bends over once the piece has met the heat. */
export function conePosture(status: PieceStatus | FiringStatus): 'upright' | 'bent' {
  switch (status) {
    case 'firing':
    case 'cooling':
    case 'unloadable':
    case 'ready':
    case 'collected':
    case 'uncollected':
    case 'unloaded':
      return 'bent';
    default:
      return 'upright';
  }
}

export function stageOfPlan(plan: Plan): Stage {
  return plan === 'glaze_only' ? 'glaze' : 'bisque';
}

export function planHasGlaze(plan: Plan): boolean {
  return plan === 'glaze_only' || plan === 'bisque_and_glaze';
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const DAMAGE_KIND_LABELS = { glaze_run: 'Glaze run', crack: 'Crack' } as const;

export const DAMAGE_STATUS_LABELS = {
  reported: 'Open',
  charged: 'Charged',
  waived: 'Waived',
} as const;

export const HISTORY_ACTIONS = [
  'accepted',
  'paid',
  'placed',
  'moved',
  'removed',
  'fired',
  'unloaded',
  'collected',
  'uncollected',
  'damage reported',
  'damage charged',
  'damage waived',
  'tracking revoked',
  'tracking replaced',
] as const;

export type HistoryAction = (typeof HISTORY_ACTIONS)[number];
