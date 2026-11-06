import { ApiError, errors } from './errors.js';
import type { PlacementRow, StaffRow, WallRow } from './store.js';

export const CENTRE_LINE_MM = 1450;
export const MIN_GAP_MM = 200;
export const UNDO_WINDOW_MS = 10_000;

export type HangCheckReason = 'off_wall' | 'off_centre_line' | 'too_close' | 'too_bright';

export interface HangCheckResult {
  reason: HangCheckReason | null;
  neighbourTitle?: string;
}

export interface HangCandidate {
  widthMm: number;
  heightMm: number;
  wallId: string;
  offsetMm: number;
  centreHeightMm: number;
  heightOverride: boolean;
}

/** The published sentences for each hang-rule rejection. */
export function hangRejectionMessage(
  reason: HangCheckReason,
  context: { wallName: string; plannedLux?: number; luxLimit?: number; neighbourTitle?: string }
): string {
  switch (reason) {
    case 'off_wall':
      return `Runs off the wall: keep the whole work on ${context.wallName}.`;
    case 'off_centre_line':
      return 'Off the 145 cm centre line: set the centre height to 145 cm or mark it as an exception.';
    case 'too_close':
      return `Too close to ${context.neighbourTitle ?? 'a neighbouring work'}: keep at least 20 cm between works.`;
    case 'too_bright':
      return `Too bright for this work: ${context.wallName} is lit at ${context.plannedLux ?? 0} lux and the limit is ${context.luxLimit ?? 0} lux.`;
  }
}

/** The one place the hang rules are decided. Returns the first failing reason and the neighbour concerned. */
export function checkHangRules(
  candidate: HangCandidate,
  wall: WallRow,
  neighbours: { placementId: string; offsetMm: number; widthMm: number; title: string }[],
  luxLimit: number,
  wallPlannedLux: number
): HangCheckResult {
  // 1. off_wall: the whole work on the wall
  const leftEdge = candidate.offsetMm - Math.floor(candidate.widthMm / 2);
  const rightEdge = candidate.offsetMm + Math.ceil(candidate.widthMm / 2);
  if (leftEdge < 0 || rightEdge > wall.lengthMm) return { reason: 'off_wall' };
  const bottom = candidate.centreHeightMm - Math.floor(candidate.heightMm / 2);
  const top = candidate.centreHeightMm + Math.ceil(candidate.heightMm / 2);
  if (bottom < 0 || top > wall.heightMm) return { reason: 'off_wall' };

  // 2. off_centre_line
  if (!candidate.heightOverride && candidate.centreHeightMm !== CENTRE_LINE_MM) {
    return { reason: 'off_centre_line' };
  }

  // 3. too_close: gap of at least 200 mm between edges; exactly 200 mm allowed.
  // On a tie the neighbour with the lower offset wins.
  let worst: { gap: number; title: string; offset: number } | null = null;
  for (const n of neighbours) {
    const nLeft = n.offsetMm - Math.floor(n.widthMm / 2);
    const nRight = n.offsetMm + Math.ceil(n.widthMm / 2);
    const gap = leftEdge >= nRight ? leftEdge - nRight : nLeft >= rightEdge ? nLeft - rightEdge : 0;
    if (gap >= MIN_GAP_MM) continue;
    if (
      worst === null ||
      gap < worst.gap ||
      (gap === worst.gap && n.offsetMm < worst.offset)
    ) {
      worst = { gap, title: n.title, offset: n.offsetMm };
    }
  }
  if (worst) return { reason: 'too_close', neighbourTitle: worst.title };

  // 4. too_bright
  if (wallPlannedLux > luxLimit) return { reason: 'too_bright' };
  return { reason: null };
}

export interface HangCheckResult {
  reason: HangCheckReason | null;
  neighbourTitle?: string;
}

export const PLACEMENT_STATUSES = ['proposed', 'claimed', 'hung', 'signed_off', 'removed'] as const;
export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number];

/** The one place the placement lifecycle is decided. */
export function canTransition(
  from: PlacementStatus, to: PlacementStatus, kind: 'claim' | 'release' | 'hang' | 'sign-off' | 'delete' | 'restore'
): boolean {
  switch (kind) {
    case 'claim': return from === 'proposed' || from === 'claimed';
    case 'release': return from === 'claimed';
    case 'hang': return from === 'claimed';
    case 'sign-off': return from === 'hung';
    case 'delete': return from === 'proposed';
    case 'restore': return from === 'removed';
  }
}

/** The one place the preview lifecycle is decided. */
export type PreviewStatus = 'draft' | 'scheduled' | 'published' | 'withdrawn';
export function canPreviewTransition(
  from: PreviewStatus, to: PreviewStatus,
  kind: 'schedule' | 'cancel' | 'publish' | 'withdraw'
): boolean {
  switch (kind) {
    case 'schedule': return from === 'draft' || from === 'withdrawn';
    case 'cancel': return from === 'scheduled';
    case 'publish': return from === 'scheduled';
    case 'withdraw': return from === 'published';
  }
}

export interface UndoWindow { actionId: string; kind: 'remove' | 'move'; undoUntil: string; remainingMs: number }

export function undoWindow(now: Date, actionId: string, kind: 'remove' | 'move'): UndoWindow {
  const undoUntil = new Date(now.getTime() + UNDO_WINDOW_MS);
  return {
    actionId,
    kind,
    undoUntil: undoUntil.toISOString(),
    remainingMs: UNDO_WINDOW_MS,
  };
}

export function remainingMs(now: Date, undoUntil: string): number {
  return Math.max(0, new Date(undoUntil).getTime() - now.getTime());
}

/** Who may move a placement, as qualified in Business rules. */
export function mayMovePlacement(
  staff: StaffRow, placement: PlacementRow, wantsWallChange: boolean
): ApiError | null {
  if (staff.role === 'registrar') return errors.forbidden("Registrars don't move works.");
  if (placement.status === 'hung' || placement.status === 'signed_off' || placement.status === 'removed') {
    return new ApiError(409, 'placement_locked', 'This work is hung, signed off or removed and can no longer be moved.');
  }
  if (staff.role === 'preparator') {
    if (wantsWallChange) return errors.forbidden('Preparators may not move a work to another wall.');
    if (placement.status === 'claimed') {
      if (placement.claimedBy?.id !== staff.id) {
        return errors.forbidden('Only the claim holder may move this work.');
      }
      return null;
    }
    return errors.forbidden('Preparators may only move works they hold.');
  }
  if (placement.status === 'claimed') {
    return errors.forbidden('This work is claimed, so only the claim holder may move it.');
  }
  return null;
}
