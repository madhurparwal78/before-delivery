import type {
  ApplicationClass,
  AssetClass,
  Audience,
  ConditionKind,
  Decision,
  GrantStatus,
  ProofStatus,
  RequestState,
  Role,
  VersionState,
} from './types.js';

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  mark: 'Mark',
  spot_icon: 'Spot icon',
  pictogram: 'Pictogram',
  ui_icon: 'UI icon',
  illustration: 'Illustration',
  photograph: 'Photograph',
};

export const ASSET_CLASS_KEYS: AssetClass[] = [
  'mark',
  'spot_icon',
  'pictogram',
  'ui_icon',
  'illustration',
  'photograph',
];

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

export const APPLICATION_KEYS: ApplicationClass[] = [
  'internal_comms',
  'social',
  'press_article',
  'event',
  'film',
  'packaging',
  'co_brand',
  'merchandise',
  'partnership',
];

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

export const DECISION_LABELS: Record<Decision, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  request_changes: 'Changes requested',
};

export const VERSION_STATE_WORDS: Record<VersionState, string> = {
  draft: 'draft',
  in_review: 'in review',
  approved: 'approved',
  published: 'published',
  superseded: 'superseded',
};

export const CONDITION_LABELS: Record<ConditionKind, string> = {
  clear_space: 'Clear space',
  no_recolour: 'No recolour',
  attribution: 'Attribution',
  proof_required: 'Proof required',
  territory: 'Territory',
  expiry_override: 'Expiry override',
};

export const CONDITION_KINDS: ConditionKind[] = [
  'clear_space',
  'no_recolour',
  'attribution',
  'proof_required',
  'territory',
  'expiry_override',
];

export const AUDIENCE_PLURALS: Record<Audience, string> = {
  employee: 'employees',
  agency: 'agencies',
  press: 'press contacts',
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Brand owner',
  brand_reviewer: 'Brand reviewer',
  legal_reviewer: 'Legal reviewer',
  author: 'Chapter author',
  agency: 'Agency partner',
  employee: 'Employee',
  press: 'Press contact',
};

export function audienceOf(role: Role): Audience {
  if (role === 'agency') return 'agency';
  if (role === 'press') return 'press';
  return 'employee';
}

export const AUDIT_ACTIONS: string[] = [
  'request.submitted',
  'request.assigned',
  'request.decided',
  'request.withdrawn',
  'request.escalated',
  'request.expired',
  'condition.added',
  'grant.minted',
  'grant.activated',
  'grant.revoked',
  'proof.uploaded',
  'proof.accepted',
  'proof.rejected',
  'asset.released',
  'asset.restricted',
  'asset.retired',
  'chapter.submitted',
  'chapter.approved',
  'chapter.changes_requested',
  'chapter.published',
  'link.issued',
];

export const CHAPTER_SLUGS = ['logo', 'colour', 'typography', 'iconography', 'motion', 'voice'] as const;
