export type Role = 'owner' | 'brand_reviewer' | 'legal_reviewer' | 'author' | 'agency' | 'employee' | 'press';

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

export type StageKind = 'brand' | 'legal';

export type Decision = 'approve' | 'reject' | 'request_changes';

export type GrantStatus = 'active' | 'pending_proof' | 'revoked' | 'expired' | 'zero_length';

export type ProofStatus = 'pending_review' | 'accepted' | 'rejected';

export type ConditionKind =
  | 'clear_space'
  | 'no_recolour'
  | 'attribution'
  | 'proof_required'
  | 'territory'
  | 'expiry_override';

export type Badge = 'Available' | 'Request required' | 'Restricted' | 'Retired';

export type VersionState = 'draft' | 'in_review' | 'approved' | 'published' | 'superseded';

export type Escalation = null | 'no_eligible_reviewer' | 'deadline_missed';

export type GrantCap = 'campaign end' | 'licence term' | 'expiry override' | 'engagement end';

export interface Principal {
  id: string;
  displayName: string;
  role: Role;
  organisationId: string;
}

export interface GrantSummary {
  id: string;
  status: GrantStatus;
  statusLabel: string;
  notBefore: string | null;
  notAfter: string;
  conditions: { kind: ConditionKind; text: string }[];
}

export interface DerivativeSummary {
  id: string;
  fileName: string;
  format: 'png' | 'svg';
  width: number;
  height: number;
}

export interface LibraryCard {
  assetId: string;
  variantId: string | null;
  cardName: string;
  classLabel: string;
  licenceName: string;
  badge: Badge;
  reason: string | null;
  successorName: string | null;
  canRequest: boolean;
  requestReason: string | null;
  openRequestId: string | null;
  derivatives: DerivativeSummary[];
  grant: GrantSummary | null;
}

export interface StageView {
  n: number;
  kind: StageKind;
  label: string;
  assigneeName: string | null;
  decision: Decision | null;
  decisionLabel: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
}

export interface ProofView {
  id: string;
  fileName: string;
  status: ProofStatus;
  statusLabel: string;
  reason: string | null;
  uploadedAt: string;
}

export interface GrantPreview {
  notBefore: string;
  notAfter: string;
  cap: GrantCap;
  zeroLength: boolean;
}

export interface RequestDetail {
  id: string;
  state: RequestState;
  stateLabel: string;
  holder: { id: string; displayName: string };
  requester: { id: string; displayName: string; organisationName: string };
  cardName: string;
  assetId: string;
  variantId: string | null;
  applicationClass: ApplicationClass;
  applicationLabel: string;
  territories: string[];
  campaignStartsOn: string;
  campaignEndsOn: string;
  citedRules: { identifier: string; status: 'live' | 'withdrawn' }[];
  note: string | null;
  submittedAt: string | null;
  deadline: string | null;
  escalation: Escalation;
  stages: StageView[];
  conditions: { id: string; kind: ConditionKind; text: string }[];
  grant: (GrantSummary & { cap: GrantCap }) | null;
  proofs: ProofView[];
  stageReason?: string;
  grantPreview?: GrantPreview;
}

export interface RequestSummary {
  id: string;
  cardName: string;
  applicationLabel: string;
  stateLabel: string;
  deadline: string | null;
  holderName: string;
}

export interface GrantView {
  id: string;
  status: GrantStatus;
  statusLabel: string;
  holder: { type: 'principal' | 'group'; id: string; displayName: string };
  cardName: string;
  requestId: string | null;
  notBefore: string | null;
  notAfter: string;
  cap: GrantCap | null;
  conditions: { kind: ConditionKind; text: string }[];
  revokedReason: string | null;
}

export interface QueueRow {
  requestId: string;
  stage: number;
  stageLabel: string;
  cardName: string;
  applicationLabel: string;
  requesterName: string;
  organisationName: string;
  deadline: string;
  escalation: Escalation;
}

export interface Statement {
  identifier: string;
  text: string;
}

export interface ChapterSummary {
  slug: string;
  title: string;
  version: number;
  publishedAt: string;
  ruleCount: number;
}

export interface ChapterDetail {
  slug: string;
  title: string;
  version: number;
  publishedAt: string;
  intro: string;
  statements: Statement[];
  assets: string[];
}

export interface RuleView {
  identifier: string;
  status: 'live' | 'withdrawn';
  chapter?: string;
  text?: string;
  withdrawnInVersion?: number;
  replacedBy?: string;
}

export interface AuditRecord {
  sequence: number;
  occurredAt: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  outcome: 'success' | 'denied';
  previousHash: string;
  recordHash: string;
}

export interface AdminDerivative {
  id: string;
  variant: string | null;
  fileName: string;
  format: 'png' | 'svg';
  width: number;
  height: number;
  byteSize: number;
}

export interface AdminAsset {
  id: string;
  name: string;
  class: AssetClass;
  state: AssetState;
  successorId: string | null;
  derivatives: AdminDerivative[];
}

export interface LiveEvent {
  type: 'request.updated' | 'queue.updated' | 'library.updated' | 'grant.updated' | 'chapter.updated';
  requestId?: string;
  grantId?: string;
  slug?: string;
}
