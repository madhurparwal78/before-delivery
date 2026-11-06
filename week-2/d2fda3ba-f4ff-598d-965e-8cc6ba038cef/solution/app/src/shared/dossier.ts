// The dossier lifecycle table from Business rules, decided here and nowhere else.

export type DossierState = "draft" | "in_review" | "published" | "unpublished" | "lapsed";

export type DossierAction = "create_preview_link" | "revoke_preview_link" | "expire_preview_link"
  | "publish" | "unpublish" | "takedown" | "reopen";

const TRANSITIONS: Record<DossierAction, { from: readonly DossierState[]; to: DossierState }> = {
  create_preview_link: { from: ["draft", "in_review"], to: "in_review" },
  revoke_preview_link: { from: ["in_review"], to: "draft" },
  expire_preview_link: { from: ["in_review"], to: "draft" },
  publish: { from: ["draft", "in_review", "published"], to: "published" },
  unpublish: { from: ["published"], to: "unpublished" },
  takedown: { from: ["published"], to: "lapsed" },
  reopen: { from: ["unpublished", "lapsed"], to: "draft" },
};

/** The state an action leads to, or null when the lifecycle does not allow it. */
export function transition(state: DossierState, action: DossierAction): DossierState | null {
  const rule = TRANSITIONS[action];
  return rule.from.includes(state) ? rule.to : null;
}

export const STATE_LABEL: Record<DossierState, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  unpublished: "Unpublished",
  lapsed: "Lapsed",
};
