// Browser draft storage: text drafts, divider positions, marker coordinates, staged orders and
// queued audit marks are kept per namespace and workspace (brief: Interactions, Drafts).

export const draftKey = (ns: string, workspace: string, item: string) => `flan:${ns}:${workspace}:${item}`;

export interface IntakeDraft {
  reference: string;
}

export interface CorrectionDraft {
  correction: string;
}

export interface MarkerDraft {
  note: string;
  x: number;
  y: number;
  /** The annotation this draft saves to; kept after a save so later saves update the same note. */
  annotation?: string;
}

/** Workspace slugs of `/desk/<ns>/<workflow>`, keyed by the brief's workflow keys. */
export const WORKSPACES = {
  intake: "intake",
  attribution: "attribution",
  catalog_reconciliation: "reconciliation",
  tray_placement: "tray",
  set_tracking: "album",
  condition_comparison: "condition",
  duplicate_selection: "keepers",
  stock_audit: "audit",
  offer_assembly: "offers",
  counteroffers: "counteroffers",
  dispatch: "dispatch",
  receipt: "receipt",
  disputes: "disputes",
} as const;

export type WorkflowKey = keyof typeof WORKSPACES | "cross-cutting";
export type WorkspaceSlug = (typeof WORKSPACES)[keyof typeof WORKSPACES];

export const EXCHANGE_WORKSPACES: readonly WorkspaceSlug[] = ["offers", "counteroffers", "dispatch", "receipt", "disputes"];
