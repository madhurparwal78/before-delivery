import type {
  ApplicationClass,
  AssetClass,
  AssetState,
  Audience,
  ConditionKind,
  Decision,
  Escalation,
  GrantCap,
  GrantStatus,
  ProofStatus,
  RequestState,
  Role,
  StageKind,
  Statement,
  VersionState,
} from '../../shared/types.js';

export interface OrganisationRecord {
  id: string;
  name: string;
  kind: 'brand' | 'agency' | 'press';
  territory: string;
  engagementStartsOn: string | null;
  engagementEndsOn: string | null;
  territories: string[];
}

export interface PrincipalRecord {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  organisationId: string;
}

export interface LicenceRecord {
  id: string;
  name: string;
  permittedApplications: ApplicationClass[];
  prohibitedApplications: ApplicationClass[];
  audiences: Audience[];
  territories: string[];
  excludedTerritories: string[];
  defaultDurationDays: number;
  modificationPermitted: boolean;
  attributionRequired: boolean;
}

export interface AssetRecord {
  id: string;
  name: string;
  assetClass: AssetClass;
  state: AssetState;
  licenceId: string;
  successorId: string | null;
  sort: number;
}

export interface VariantRecord {
  id: string;
  assetId: string;
  key: string;
  label: string;
  sort: number;
}

export interface DerivativeRecord {
  id: string;
  assetId: string;
  variantId: string | null;
  fileName: string;
  format: 'png' | 'svg';
  width: number;
  height: number;
  byteSize: number;
  objectKey: string;
  sort: number;
}

export interface GrantRecord {
  id: string;
  holderPrincipalId: string | null;
  holderGroupId: string | null;
  assetId: string;
  variantId: string | null;
  requestId: string | null;
  notBefore: string | null;
  notAfter: string;
  status: GrantStatus;
  cap: GrantCap | null;
  revokedReason: string | null;
}

export interface ConditionRecord {
  id: string;
  requestId: string | null;
  grantId: string | null;
  kind: ConditionKind;
  value: string | null;
  text: string;
  addedBy: string | null;
}

export interface StageRecord {
  requestId: string;
  n: number;
  kind: StageKind;
  assigneeId: string | null;
  decision: Decision | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  comment: string | null;
}

export interface RequestRecord {
  id: string;
  requesterId: string;
  assetId: string;
  variantId: string | null;
  applicationClass: ApplicationClass;
  territories: string[];
  campaignStartsOn: string;
  campaignEndsOn: string;
  citedRules: string[];
  note: string | null;
  state: RequestState;
  holderId: string;
  submittedAt: Date | null;
  deadline: Date | null;
  escalation: Escalation;
  submissionSeq: number;
}

export interface ProofRecord {
  id: string;
  grantId: string;
  fileName: string;
  status: ProofStatus;
  reason: string | null;
  uploadedAt: Date;
  objectKey: string;
  contentType: string;
}

export interface WithdrawnEntry {
  identifier: string;
  replacedBy: string;
}

export interface VersionRecord {
  id: string;
  slug: string;
  number: number;
  state: VersionState;
  authorId: string | null;
  publishedAt: Date | null;
  intro: string;
  statements: Statement[];
  assetIds: string[];
  withdrawn: WithdrawnEntry[];
  revision: number;
  reviewComment: string | null;
}

export interface Viewer {
  principal: PrincipalRecord;
  organisation: OrganisationRecord;
  groupIds: string[];
}
