// Piece states: logged → waiting_bisque → bisqued → waiting_glaze → glazed →
// ready_for_pickup → collected | uncollected. Collected and uncollected are final.

import type { PieceStatus } from "../types";

export type CheckInRefusal = "member_inactive" | "photo_required" | "illegal_transition";

// Check-in moves logged → waiting_bisque and bisqued → waiting_glaze. The first move
// is refused for an inactive owner or a piece without a photo.
export function checkInRefusal(status: PieceStatus, opts: { ownerActive: boolean; hasPhoto: boolean }): CheckInRefusal | null {
  if (status === "logged") {
    if (!opts.ownerActive) return "member_inactive";
    if (!opts.hasPhoto) return "photo_required";
    return null;
  }
  if (status === "bisqued") return null;
  return "illegal_transition";
}

export function collectRefusal(status: PieceStatus): boolean {
  return status !== "ready_for_pickup";
}

export function markUncollectedRefusal(status: PieceStatus): "illegal_transition" | null {
  if (status !== "ready_for_pickup") return "illegal_transition";
  return null;
}

export function isWaiting(status: PieceStatus): boolean {
  return status === "waiting_bisque" || status === "waiting_glaze";
}

export function isFinal(status: PieceStatus): boolean {
  return status === "collected" || status === "uncollected";
}
