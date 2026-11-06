export const TRADES = ["electrical", "plumbing", "tile", "paint", "carpentry", "hvac", "flooring"] as const;
export type TradeKey = (typeof TRADES)[number];
export const TRADE_LABELS: Record<TradeKey, string> = {
  electrical: "Electrical",
  plumbing: "Plumbing",
  tile: "Tile",
  paint: "Paint",
  carpentry: "Carpentry",
  hvac: "HVAC",
  flooring: "Flooring",
};

export type ItemStatus = "open" | "in_progress" | "ready_for_check" | "verified";
export const STATUS_LABELS: Record<ItemStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  ready_for_check: "Ready for check",
  verified: "Verified",
};
export type PinStatus = "placed" | "unpinned" | "needs_review";
export type JobStatus = "active" | "walkthrough" | "closed_out";
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  active: "Active",
  walkthrough: "Walkthrough",
  closed_out: "Closed out",
};
export type Role = "owner" | "lead" | "trade" | "homeowner";

export type Pt = { x: number; y: number };
export type Outline = Pt[];
