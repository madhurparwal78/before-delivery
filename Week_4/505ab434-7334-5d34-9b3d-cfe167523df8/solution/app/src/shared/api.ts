// Response shapes of the HTTP API (brief: Backend / API and Projected shapes). Shared by server and browser.
import type {
  AssetClass,
  AssetState,
  Badge,
  ConditionKind,
  Escalation,
  GrantCap,
  GrantStatus,
  ProofStatus,
  RequestState,
  Role,
  VersionState,
} from "./domain.ts";

export interface ApiErrorBody {
  error: string;
  message: string;
}

export interface Principal {
  id: string;
  displayName: string;
  role: Role;
  organisationId: string;
}

export interface Engagement {
  startsOn: string;
  endsOn: string;
  territories: string[];
}

export interface MeResponse {
  principal: Principal;
  /** The caller's organisation engagement (agency partners), which the request dialog's territories come from. */
  engagement: Engagement | null;
  today: string;
  now: string;
  timeZone: string;
  weightAnnounceDelayMs: number;
}

/** Embedded in every HTML page so anonymous chapter pages can format dates and delay announcements. */
export interface Bootstrap {
  today: string;
  now: string;
  timeZone: string;
  weightAnnounceDelayMs: number;
}

export interface ConditionText {
  kind: ConditionKind;
  text: string;
}

export interface CardGrant {
  id: string;
  status: GrantStatus;
  statusLabel: string;
  notBefore: string | null;
  notAfter: string;
  conditions: ConditionText[];
}

export interface CardDerivative {
  id: string;
  fileName: string;
  format: "png" | "svg";
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
  derivatives: CardDerivative[];
  grant: CardGrant | null;
}

export interface LibraryResponse {
  count: number;
  cards: LibraryCard[];
}

export interface RequestSummary {
  id: string;
  cardName: string;
  applicationLabel: string;
  state: RequestState;
  stateLabel: string;
  deadline: string | null;
}

export interface StageView {
  n: number;
  kind: "brand" | "legal";
  label: string;
  assigneeName: string | null;
  decision: string | null;
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
  applicationClass: string;
  applicationLabel: string;
  territories: string[];
  campaignStartsOn: string;
  campaignEndsOn: string;
  citedRules: { identifier: string; status: "live" | "withdrawn" }[];
  note: string;
  submittedAt: string | null;
  deadline: string | null;
  escalation: Escalation | null;
  stages: StageView[];
  conditions: { id: string; kind: ConditionKind; text: string }[];
  grant: (CardGrant & { cap: GrantCap | null }) | null;
  proofs: ProofView[];
  stageReason?: string;
  grantPreview?: GrantPreview;
}

export interface GrantView {
  id: string;
  status: GrantStatus;
  statusLabel: string;
  holder: { type: "principal" | "group"; id: string; displayName: string };
  cardName: string;
  requestId: string | null;
  notBefore: string | null;
  notAfter: string;
  cap: GrantCap | null;
  conditions: ConditionText[];
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
  escalation: Escalation | null;
}

export interface AdminDerivative {
  id: string;
  variant: string | null;
  fileName: string;
  format: "png" | "svg";
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

export interface ChapterSummary {
  slug: string;
  title: string;
  version: number;
  publishedAt: string;
  ruleCount: number;
}

export interface ChapterPage {
  slug: string;
  title: string;
  version: number;
  publishedAt: string;
  intro: string;
  statements: { identifier: string; text: string }[];
  assets: string[];
}

export type RuleView =
  | { identifier: string; status: "live"; chapter: string; text: string }
  | { identifier: string; status: "withdrawn"; withdrawnInVersion: number; replacedBy: string };

export interface VersionView {
  id: string;
  slug: string;
  number: number;
  state: VersionState;
  revision: number;
  publishedAt: string | null;
  intro: string;
  statements: { identifier: string; text: string }[];
  assetIds: string[];
  withdrawn: { identifier: string; replacedBy: string }[];
  reviewComment: string | null;
  /** Every asset an editor may reference (present for authors, brand reviewers and the owner). */
  assetOptions?: { id: string; name: string }[];
}

export interface AuditRecord {
  sequence: number;
  occurredAt: string;
  actorId: string;
  /** Display name of the actor, or `System`; filled by the server so the audit screen can print names. */
  actorName?: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  outcome: "success" | "denied";
  previousHash: string;
  recordHash: string;
}

export type LiveMessage =
  | { type: "request.updated"; requestId: string }
  | { type: "queue.updated" }
  | { type: "library.updated" }
  | { type: "grant.updated"; grantId: string }
  | { type: "chapter.updated"; slug: string };
