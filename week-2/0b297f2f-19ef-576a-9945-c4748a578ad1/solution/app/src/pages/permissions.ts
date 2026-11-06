// Which card and inspector actions to offer the person working now (the server decides for real).
import type { Placement, Staff } from "../types";

export function mayMove(staff: Staff | null, p: Placement): boolean {
  if (!staff) return false;
  if (staff.role === "curator") return p.status === "proposed";
  return staff.role === "preparator" && p.status === "claimed" && p.claimedBy?.id === staff.id;
}

export function mayRemove(staff: Staff | null, p: Placement): boolean {
  return staff?.role === "curator" && p.status === "proposed";
}

export function cardActions(staff: Staff | null, p: Placement | undefined) {
  const role = staff?.role;
  const holds = p?.status === "claimed" && p.claimedBy?.id === staff?.id;
  return {
    place: role === "curator" && !p,
    claim: role === "preparator" && p?.status === "proposed",
    release: role === "preparator" && holds,
    hang: role === "preparator" && holds,
    signOff: role === "registrar" && p?.status === "hung",
    photo: role === "registrar",
  };
}
