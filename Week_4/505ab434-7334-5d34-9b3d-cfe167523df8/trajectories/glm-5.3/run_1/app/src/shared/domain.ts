export type Role =
  | 'owner'
  | 'brand_reviewer'
  | 'legal_reviewer'
  | 'author'
  | 'agency'
  | 'employee'
  | 'press';

export type Audience = 'employee' | 'agency' | 'press';

export type AssetClass = 'mark' | 'spot_icon' | 'pictogram' | 'ui_icon' | 'illustration' | 'photograph';
export type AssetState = 'draft' | 'released' | 'restricted' | 'retired';

export type ApplicationClass =
  | 'internal_comms'
  | 'social'
  | 'press_article'
  | 'event'
  | 'film'
  | 'packaging'
  | 'co_brand'
  | 'merchandise'
  | 'partnership';

export type RequestState =
  | 'draft'
  | 'routed'
  | 'under_review'
  | 'changes_requested'
  | 'approved'
  | 'granted'
  | 'rejected'
  | 'withdrawn'
  | 'expired';

export type GrantStatus = 'active' | 'pending_proof' | 'revoked' | 'expired' | 'zero_length';
export type ProofStatus = 'pending_review' | 'accepted' | 'rejected';
export type ConditionKind =
  | 'clear_space'
  | 'no_recolour'
  | 'attribution'
  | 'proof_required'
  | 'territory'
  | 'expiry_override';
export type VersionState = 'draft' | 'in_review' | 'approved' | 'published' | 'superseded';
export type Decision = 'approve' | 'reject' | 'request_changes';
export type Escalation = 'no_eligible_reviewer' | 'deadline_missed' | null;

export interface Principal {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  organisationId: string | null;
}

export const CLASS_LABELS: Record<AssetClass, string> = {
  mark: 'Mark',
  spot_icon: 'Spot icon',
  pictogram: 'Pictogram',
  ui_icon: 'UI icon',
  illustration: 'Illustration',
  photograph: 'Photograph',
};

export const APPLICATION_LABELS: Record<ApplicationClass, string> = {
  internal_comms: 'Internal comms',
  social: 'Social',
  press_article: 'Press article',
  event: 'Event',
  film: 'Film',
  packaging: 'Packaging',
  co_brand: 'Co-brand',
  merchandise: 'Merchandise',
  partnership: 'Partnership',
};

export const REQUEST_STATE_LABELS: Record<RequestState, string> = {
  draft: 'Draft',
  routed: 'Routed',
  under_review: 'Under review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  granted: 'Granted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

export const GRANT_STATUS_LABELS: Record<GrantStatus, string> = {
  active: 'Active',
  pending_proof: 'Pending proof',
  revoked: 'Revoked',
  expired: 'Expired',
  zero_length: 'Zero-length',
};

export const PROOF_STATUS_LABELS: Record<ProofStatus, string> = {
  pending_review: 'Pending review',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const VERSION_STATE_WORDS: Record<VersionState, string> = {
  draft: 'draft',
  in_review: 'in review',
  approved: 'approved',
  published: 'published',
  superseded: 'superseded',
};

export const DECISION_LABELS: Record<Decision, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  request_changes: 'Changes requested',
};

export const CONDITION_LABELS: Record<ConditionKind, string> = {
  clear_space: 'Clear space',
  no_recolour: 'No recolour',
  attribution: 'Attribution',
  proof_required: 'Proof required',
  territory: 'Territory',
  expiry_override: 'Expiry override',
};

export const CONDITION_FIELD_LABELS: Record<ConditionKind, string> = {
  clear_space: 'Clear space',
  no_recolour: 'No recolour',
  attribution: 'Attribution',
  proof_required: 'Proof required',
  territory: 'Territory',
  expiry_override: 'Expiry override',
};

export const BADGE_AVAILABLE = 'Available';
export const BADGE_REQUEST_REQUIRED = 'Request required';
export const BADGE_RESTRICTED = 'Restricted';
export const BADGE_RETIRED = 'Retired';

export type Badge = typeof BADGE_AVAILABLE | typeof BADGE_REQUEST_REQUIRED | typeof BADGE_RESTRICTED | typeof BADGE_RETIRED;

export const AUDIENCE_PLURALS: Record<Audience, string> = {
  employee: 'employees',
  agency: 'agencies',
  press: 'press contacts',
};

export const CHAPTER_SLUGS = ['logo', 'colour', 'typography', 'iconography', 'motion', 'voice'] as const;
export type ChapterSlug = (typeof CHAPTER_SLUGS)[number];

export function audienceOfRole(role: Role): Audience {
  if (role === 'agency') return 'agency';
  if (role === 'press') return 'press';
  return 'employee';
}

export function isRole(value: string): value is Role {
  return [
    'owner',
    'brand_reviewer',
    'legal_reviewer',
    'author',
    'agency',
    'employee',
    'press',
  ].includes(value);
}

export function isAssetClass(value: string): value is AssetClass {
  return value in CLASS_LABELS;
}

export function isApplicationClass(value: string): value is ApplicationClass {
  return value in APPLICATION_LABELS;
}

export function isRequestState(value: string): value is RequestState {
  return value in REQUEST_STATE_LABELS;
}

export const ROLE_AUDIENCES = audienceOfRole;

/** Roles that count as employees for licence audiences. */
export function brandSideAudience(role: Role): Audience {
  return audienceOfRole(role);
}
