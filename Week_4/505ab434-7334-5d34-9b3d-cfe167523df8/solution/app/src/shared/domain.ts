// Vocabulary shared by the server and the browser: roles, labels, tiers, state words.

export const ROLES = ["owner", "brand_reviewer", "legal_reviewer", "author", "agency", "employee", "press"] as const;
export type Role = (typeof ROLES)[number];

export const AUDIENCES = ["employee", "agency", "press"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_PLURALS: Record<Audience, string> = {
  employee: "employees",
  agency: "agencies",
  press: "press contacts",
};

/** The brand's own people count as employees for licence audiences. */
export function audienceOf(role: Role): Audience {
  return role === "agency" ? "agency" : role === "press" ? "press" : "employee";
}

/** Roles that may open the review queue. */
export const REVIEW_ROLES: readonly Role[] = ["owner", "brand_reviewer", "legal_reviewer"];

export const ASSET_CLASSES = ["mark", "spot_icon", "pictogram", "ui_icon", "illustration", "photograph"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  mark: "Mark",
  spot_icon: "Spot icon",
  pictogram: "Pictogram",
  ui_icon: "UI icon",
  illustration: "Illustration",
  photograph: "Photograph",
};

/** Pixel size every derivative of the class must have to release (classes without a contract are absent). */
export const SIZE_CONTRACTS: Partial<Record<AssetClass, readonly [number, number]>> = {
  spot_icon: [120, 120],
  pictogram: [64, 64],
  ui_icon: [24, 24],
};

export const ASSET_STATES = ["draft", "released", "restricted", "retired"] as const;
export type AssetState = (typeof ASSET_STATES)[number];

export const BADGES = ["Available", "Request required", "Restricted", "Retired"] as const;
export type Badge = (typeof BADGES)[number];

type Tier = "standard" | "extended" | "legal";

export const APPLICATIONS = [
  { value: "internal_comms", label: "Internal comms", tier: "standard", legalStage: false },
  { value: "social", label: "Social", tier: "standard", legalStage: false },
  { value: "press_article", label: "Press article", tier: "standard", legalStage: false },
  { value: "event", label: "Event", tier: "extended", legalStage: false },
  { value: "film", label: "Film", tier: "extended", legalStage: false },
  { value: "packaging", label: "Packaging", tier: "legal", legalStage: false },
  { value: "co_brand", label: "Co-brand", tier: "legal", legalStage: true },
  { value: "merchandise", label: "Merchandise", tier: "legal", legalStage: true },
  { value: "partnership", label: "Partnership", tier: "legal", legalStage: true },
] as const satisfies readonly { value: string; label: string; tier: Tier; legalStage: boolean }[];
type ApplicationClass = (typeof APPLICATIONS)[number]["value"];
export const APPLICATION_VALUES: readonly string[] = APPLICATIONS.map((a) => a.value);

export function applicationOf(value: string): (typeof APPLICATIONS)[number] | undefined {
  return APPLICATIONS.find((a) => a.value === value);
}

export const REQUEST_STATES = [
  "draft",
  "routed",
  "under_review",
  "changes_requested",
  "approved",
  "granted",
  "rejected",
  "withdrawn",
  "expired",
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const REQUEST_STATE_LABELS: Record<RequestState, string> = {
  draft: "Draft",
  routed: "Routed",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  granted: "Granted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

/** States in which a request still counts as open on its card. */
export const OPEN_REQUEST_STATES: readonly RequestState[] = ["draft", "routed", "under_review", "changes_requested"];

export type Escalation = "no_eligible_reviewer" | "deadline_missed";
export const ESCALATION_LABELS: Record<Escalation, string> = {
  no_eligible_reviewer: "Escalated: no eligible reviewer",
  deadline_missed: "Escalated: deadline missed",
};

export const DECISIONS = ["approve", "reject", "request_changes"] as const;
export type Decision = (typeof DECISIONS)[number];
export const DECISION_LABELS: Record<Decision, string> = {
  approve: "Approved",
  reject: "Rejected",
  request_changes: "Changes requested",
};

export const STAGE_KINDS = ["brand", "legal"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const GRANT_STATUSES = ["active", "pending_proof", "revoked", "expired", "zero_length"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];
export const GRANT_STATUS_LABELS: Record<GrantStatus, string> = {
  active: "Active",
  pending_proof: "Pending proof",
  revoked: "Revoked",
  expired: "Expired",
  zero_length: "Zero-length",
};

export const GRANT_CAPS = ["campaign end", "licence term", "expiry override", "engagement end"] as const;
export type GrantCap = (typeof GRANT_CAPS)[number];

export const PROOF_STATUSES = ["pending_review", "accepted", "rejected"] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];
export const PROOF_STATUS_LABELS: Record<ProofStatus, string> = {
  pending_review: "Pending review",
  accepted: "Accepted",
  rejected: "Rejected",
};

export const CONDITION_KINDS = [
  "clear_space",
  "no_recolour",
  "attribution",
  "proof_required",
  "territory",
  "expiry_override",
] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];
export const CONDITION_LABELS: Record<ConditionKind, string> = {
  clear_space: "Clear space",
  no_recolour: "No recolour",
  attribution: "Attribution",
  proof_required: "Proof required",
  territory: "Territory",
  expiry_override: "Expiry override",
};

export const VERSION_STATES = ["draft", "in_review", "approved", "published", "superseded"] as const;
export type VersionState = (typeof VERSION_STATES)[number];
export const VERSION_STATE_WORDS: Record<VersionState, string> = {
  draft: "draft",
  in_review: "in review",
  approved: "approved",
  published: "published",
  superseded: "superseded",
};

export const CHAPTER_SLUGS = ["logo", "colour", "typography", "iconography", "motion", "voice"] as const;
type ChapterSlug = (typeof CHAPTER_SLUGS)[number];

export const AUDIT_ACTIONS = [
  "request.submitted",
  "request.assigned",
  "request.decided",
  "request.withdrawn",
  "request.escalated",
  "request.expired",
  "condition.added",
  "grant.minted",
  "grant.activated",
  "grant.revoked",
  "proof.uploaded",
  "proof.accepted",
  "proof.rejected",
  "asset.released",
  "asset.restricted",
  "asset.retired",
  "chapter.submitted",
  "chapter.approved",
  "chapter.changes_requested",
  "chapter.published",
  "chapter.started",
  "chapter.saved",
  "link.issued",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const IDENTIFIER_PATTERN = /^[a-z]+\.[a-z0-9-]+\.[a-z0-9-]+$/;

export const JSON_BODY_LIMIT = 100_000;
export const DERIVATIVE_MAX_BYTES = 10_485_760;

export const FEEDBACK_PENDING = {
  signIn: "Signing in",
  upload: "Uploading",
  verify: "Checking chain",
  save: "Saving",
} as const;
