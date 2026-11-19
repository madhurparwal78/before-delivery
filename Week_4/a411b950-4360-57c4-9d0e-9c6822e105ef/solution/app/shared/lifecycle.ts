// The state machines and writable-field lists, shared by the server (which enforces them) and the console
// (which shows only the legal actions and sends only these fields).

export type ProjectStatus = "draft" | "in_review" | "published" | "withdrawn";

/** The project lifecycle: every other move is an illegal transition. */
export const PROJECT_MOVES: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ["in_review", "withdrawn"],
  in_review: ["draft", "published", "withdrawn"],
  published: ["withdrawn"],
  withdrawn: [],
};

/** A listening link can be created for, and works for, a project in review or published. */
export const LINKABLE: readonly ProjectStatus[] = ["in_review", "published"];

export type EnquiryStatus =
  | "new" | "qualified" | "proposal_sent" | "accepted" | "deposit_paid" | "booked" | "declined" | "expired";

/** The enquiry pipeline. Declined, expired and booked are terminal. */
export const PIPELINE: Record<EnquiryStatus, readonly EnquiryStatus[]> = {
  new: ["qualified", "declined"],
  qualified: ["proposal_sent", "declined"],
  proposal_sent: ["accepted", "expired", "declined"],
  accepted: ["deposit_paid"],
  deposit_paid: ["booked"],
  booked: [],
  declined: [],
  expired: [],
};

export const PROJECT_WRITABLE = [
  "slug", "title", "credit_type", "credit_line", "role", "blurb", "tags", "visibility", "position", "thresholds",
] as const;

export const TRIAGE_WRITABLE = ["triage_notes", "fit_score", "rate_floor_cents"] as const;

export const PROPOSAL_WRITABLE = ["producer_name", "producer_email", "project_title", "scope", "fee_cents", "production_month"] as const;
