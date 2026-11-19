/** The drawing's derived state: status, step, lot and which panels are laid. Pure, so a list and a single read agree. */
import type { DimensionKey, DrawingStatus, Step } from "../shared/types.js";

export type Phase = "measuring" | "drawn" | "pending_store" | "issued";

interface PanelFact {
  number: number;
  cut: boolean;
}

export interface ClaimFact {
  id: string;
  stock_code: string;
  lot: string;
  status: "held" | "cut" | "released";
  taken_at: Date;
  expires_at: Date;
}

export interface LayFact {
  claim_id: string;
  panel_number: number;
}

const isLive = (claim: Pick<ClaimFact, "status" | "expires_at">, at: Date): boolean =>
  claim.status === "held" && claim.expires_at.getTime() > at.getTime();

export const effectiveClaimStatus = (claim: Pick<ClaimFact, "status" | "expires_at">, at: Date): "held" | "cut" | "lapsed" | "released" =>
  claim.status === "held" && !isLive(claim, at) ? "lapsed" : claim.status;

export interface DerivedState {
  status: DrawingStatus;
  step: Step;
  lot: string | null;
  /** panel number -> the lay that counts (live hold, or the claim it was cut on) */
  laid: Map<number, string>;
}

export function derive(
  phase: Phase,
  panels: PanelFact[],
  lays: LayFact[],
  claims: ClaimFact[],
  usedFlagged: boolean,
  at: Date,
): DerivedState {
  const byClaim = new Map(claims.map((claim) => [claim.id, claim]));
  const cutPanels = new Set(panels.filter((p) => p.cut).map((p) => p.number));
  const laid = new Map<number, string>();
  for (const lay of lays) {
    const claim = byClaim.get(lay.claim_id);
    if (!claim) continue;
    if (isLive(claim, at) || (claim.status === "cut" && cutPanels.has(lay.panel_number))) laid.set(lay.panel_number, lay.claim_id);
  }
  const pinning = claims.filter((claim) => isLive(claim, at) || claim.status === "cut").sort(byTaken)[0];
  const lot = pinning ? pinning.lot : null;
  const everyPanelAccounted = panels.length > 0 && panels.every((p) => p.cut || laid.has(p.number));
  const cutCount = cutPanels.size;
  let status: DrawingStatus;
  if (phase === "pending_store" || phase === "issued") status = phase;
  else if (phase === "measuring") status = usedFlagged ? "remeasure" : "measuring";
  else if (cutCount === panels.length) status = "cut";
  else if (cutCount > 0) status = "cutting";
  else status = everyPanelAccounted ? "nested" : "drawn";
  const met: Record<Step, boolean> = {
    measure: status !== "remeasure",
    draw: phase !== "measuring",
    nest: phase !== "measuring" && everyPanelAccounted,
    confirm: status === "cut" || status === "pending_store" || status === "issued",
  };
  const step = (["measure", "draw", "nest", "confirm"] as const).find((candidate) => !met[candidate]) ?? "confirm";
  return { status, step, lot, laid };
}

export const byTaken = (a: ClaimFact, b: ClaimFact): number => a.taken_at.getTime() - b.taken_at.getTime() || (a.id < b.id ? -1 : 1);

/** The dimensions a sail uses: P and E for a mainsail, LL and LP for a headsail. */
export function usedDimensions(sail: "mainsail" | "headsail"): { luff: DimensionKey; foot: DimensionKey } {
  return sail === "mainsail" ? { luff: "P", foot: "E" } : { luff: "LL", foot: "LP" };
}
