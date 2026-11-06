// Load states. The legal edges are decided here, and only here:
// planning → loaded (needs pieces), loaded → firing, firing → cooling,
// cooling → unloaded (unload endpoint only), planning → cancelled, loaded → cancelled.

import type { LoadStatus } from "../types";

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  planning: "Planning",
  loaded: "Loaded",
  firing: "Firing",
  cooling: "Cooling",
  unloaded: "Unloaded",
  cancelled: "Cancelled",
};

export const PIECE_STATUS_LABELS: Record<string, string> = {
  logged: "Logged",
  waiting_bisque: "Waiting for bisque",
  bisqued: "Bisqued",
  waiting_glaze: "Waiting for glaze",
  glazed: "Glazed",
  ready_for_pickup: "Ready for pickup",
  collected: "Collected",
  uncollected: "Uncollected",
};

export type LoadTransition = { to: LoadStatus; pieceCount: number; kilnBusy: boolean };

export type LoadTransitionRefusal = "illegal_transition" | "empty_load" | "kiln_busy" | null;

export function loadTransitionRefusal(from: LoadStatus, to: LoadStatus, pieceCount: number, kilnBusy: boolean): LoadTransitionRefusal {
  const legal: Record<string, LoadStatus[]> = {
    planning: ["loaded", "cancelled"],
    loaded: ["firing", "cancelled"],
    firing: ["cooling"],
    cooling: [],
    unloaded: [],
    cancelled: [],
  };
  if (!legal[from].includes(to)) return "illegal_transition";
  if (to === "loaded" && pieceCount === 0) return "empty_load";
  if (to === "loaded" && kilnBusy) return "kiln_busy";
  return null;
}
