import { Graph } from './graph';
import { PeriodId, PlanId } from './plans';

export type Role = 'owner' | 'admin' | 'billing_manager' | 'editor' | 'viewer';
export type AuthorKind = 'member' | 'agent' | 'system';
export type AgentScope = 'read' | 'edit';

export interface Author {
  kind: AuthorKind;
  id: string;
  name: string;
}

export interface MemberDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface InviteDto {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  invitedBy: Author;
}

export interface OpDto {
  seq: number;
  batchId: string;
  type: string;
  payload: Record<string, unknown>;
  inverse: Record<string, unknown>;
  author: Author;
  createdAt: string;
  undoOf: string | null;
  redoOf: string | null;
  restoreTo: number | null;
}

export interface LockDto {
  nodeId: string;
  holder: Author;
  expiresAt: string;
}

export type VersionState = 'draft' | 'in_review' | 'scheduled' | 'published' | 'withdrawn';

export interface VersionDto {
  id: string;
  sceneId: string;
  number: number;
  label: string;
  state: VersionState;
  seq: number;
  createdBy: Author;
  approvals: { member: Author; at: string }[];
  publishAt: string | null;
  publishedAt: string | null;
  embedId: string | null;
}

export type SubscriptionState = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';

export interface SubscriptionDto {
  state: SubscriptionState;
  plan: PlanId;
  period: PeriodId;
  seatsPurchased: number;
  extraSeats: number;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  pendingChange: { plan: PlanId; period: PeriodId; extraSeats: number; effectiveAt: string } | null;
}

export interface InvoiceDto {
  id: string;
  number: string;
  date: string;
  amountCents: number;
  balanceCents: number;
  status: 'paid' | 'unpaid';
  pdfAvailable: boolean;
}

export interface PaymentDto {
  id: string;
  invoiceId: string;
  amountCents: number;
  refundedCents: number;
  createdAt: string;
}

export interface BatchResultDto {
  batchId: string;
  firstSeq: number;
  lastSeq: number;
  latestSeq: number;
  hash: string;
}

export interface SceneSummaryDto {
  id: string;
  name: string;
  latestSeq: number;
  updatedAt: string;
  publishedVersion: number | null;
}

export interface CommentDto {
  id: string;
  nodeId: string;
  body: string;
  author: Author;
  mentions: { id: string; name: string }[];
  resolved: boolean;
  createdAt: string;
}

export interface AssetDto {
  id: string;
  kind: 'model' | 'texture';
  name: string;
  bytes: number;
  contentType: string;
  uploadedBy: Author;
}

export interface AuditEntryDto {
  id: string;
  at: string;
  actor: Author;
  action: string;
  target: { type: string; id: string };
}

export interface AgentTokenDto {
  id: string;
  name: string;
  scope: AgentScope;
  expiresAt: string;
  status: 'active' | 'expired' | 'revoked';
  issuedBy: Author;
}

export interface ReviewLinkDto {
  id: string;
  expiresAt: string;
  status: 'active' | 'expired' | 'revoked';
  createdBy: Author;
}

export interface DashboardDto {
  seatsUsed: number;
  seatsPurchased: number;
  scenes: number;
  publishedScenes: number;
  scheduledVersions: number;
  activeAgentTokens: number;
  subscription: SubscriptionDto;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  timeZone: string;
  reviewLinksEnabled?: boolean;
}

export interface MeDto {
  member?: MemberDto;
  agent?: { id: string; name: string; scope: AgentScope };
  workspace: WorkspaceDto;
  subscription?: SubscriptionDto;
}

export interface SceneResponse {
  id: string;
  name: string;
  latestSeq: number;
  graph: Graph;
  hash: string;
}

export interface PublishedPayload {
  scene: { name: string };
  version: { number: number; label: string; publishedAt: string | null };
  graph: Graph;
}

export interface ReviewPayload {
  scene: { name: string };
  version: { number: number; label: string; state: VersionState };
  graph: Graph;
}
