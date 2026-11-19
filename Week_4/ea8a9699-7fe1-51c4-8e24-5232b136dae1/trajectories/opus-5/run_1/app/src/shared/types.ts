export type AccountRole = 'ops_lead' | 'designer' | 'follower';

export type ReferenceKind = 'image' | 'clip' | 'still';

export type ClusterStatus = 'draft' | 'in_review' | 'embargoed' | 'public' | 'withdrawn';

export type ReviewLinkState = 'live' | 'expired' | 'revoked' | 'inactive';

export type PlanId = 'rushes-pro-5' | 'rushes-pro-10' | 'rushes-pro-25';

export interface Credit {
  displayName: string;
  handle: string;
}

export interface AccountWorkspace {
  slug: string;
  name: string;
  timeZone: string;
  hasSeat: boolean;
}

export interface Account {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  role: AccountRole;
  workspaces: AccountWorkspace[];
}

export interface Reference {
  id: string;
  kind: ReferenceKind;
  title: string;
  mediaUrl: string;
  createdAt: string;
  createdBy: Credit;
  frameRate: number | null;
  durationMs: number | null;
  totalFrames: number | null;
  sourceClipId: string | null;
  sourceClipTitle: string | null;
  frameIndex: number | null;
  timecode: string | null;
}

export interface ClusterSummary {
  id: string;
  title: string;
  status: ClusterStatus;
  itemCount: number;
}

export interface ClusterEntry {
  id: string;
  position: number;
  isPrivate: boolean;
  reference: Reference;
}

export interface Cluster {
  id: string;
  workspace: string;
  title: string;
  publicDescription: string;
  internalNote: string;
  status: ClusterStatus;
  owner: Credit;
  itemCount: number;
  version: number;
  timeZone: string;
  liftLocal: string | null;
  liftsAt: string | null;
  publishedAt: string | null;
  entries: ClusterEntry[];
}

export interface Comment {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface PublicItem {
  id: string;
  position: number;
  title: string;
  kind: ReferenceKind;
  mediaUrl: string;
  timecode: string | null;
  sourceClipTitle: string | null;
}

export interface PublicCluster {
  id: string;
  title: string;
  publicDescription: string;
  curator: Credit;
  credits: Credit[];
  publishedAt: string;
  publicItemCount: number;
  items: PublicItem[];
}

export interface FeedCard {
  id: string;
  title: string;
  publicDescription: string;
  curator: Credit;
  publicItemCount: number;
  publishedAt: string;
  coverUrl: string | null;
}

export interface PlanView {
  plan: PlanId;
  planName: string;
  seatCap: number;
  seatsUsed: number;
  monthlyPrice: string;
  currency: 'USD';
}

export interface PlanUpgradeOption {
  plan: PlanId;
  planName: string;
  seatCap: number;
  monthlyPrice: string;
}

export interface PlanResponse extends PlanView {
  upgrades: PlanUpgradeOption[];
}

export interface UpgradeResponse extends PlanView {
  receiptSentTo: string;
}

export interface WorkspaceView {
  slug: string;
  name: string;
  timeZone: string;
  plan: PlanId;
  planName: string;
  seatCap: number;
  seatsUsed: number;
}

export interface SeatMember {
  id: string;
  displayName: string;
  email: string;
  handle: string;
  hasSeat: boolean;
}

export interface SeatsResponse {
  plan: PlanId;
  seatCap: number;
  seatsUsed: number;
  members: SeatMember[];
}

export interface SeatMutationResponse {
  memberId: string;
  seatsUsed: number;
  seatCap: number;
}

export interface ReferenceListResponse {
  items: Reference[];
  nextCursor: string | null;
}

export interface SearchResponse {
  query: string;
  counts: { clusters: number; references: number };
  clusters: ClusterSummary[];
  references: Reference[];
}

export interface ClusterListResponse {
  total: number;
  clusters: ClusterSummary[];
}

export interface EntryMutationResponse {
  entry: { id: string; position: number; isPrivate: boolean };
  itemCount: number;
  version: number;
}

export interface MoveResponse {
  version: number;
  entryIds: string[];
}

export interface StillResponse {
  reference: Reference;
  entry: { id: string; position: number; isPrivate: boolean };
  cluster: { id: string; itemCount: number; version: number };
}

export interface ReviewLinkSummary {
  id: string;
  email: string;
  expiresAt: string;
  canComment: boolean;
  state: ReviewLinkState;
}

export interface ReviewLinkCreated {
  id: string;
  email: string;
  url: string;
  expiresAt: string;
  canComment: boolean;
}

export interface ReviewEntry {
  id: string;
  position: number;
  title: string;
  kind: ReferenceKind;
  mediaUrl: string;
  timecode: string | null;
  sourceClipTitle: string | null;
  isPrivate: boolean;
}

export interface ReviewResponse {
  cluster: {
    title: string;
    publicDescription: string;
    itemCount: number;
    entries: ReviewEntry[];
  };
  comments: Comment[];
  link: { expiresAt: string; canComment: boolean };
}

export interface FeedResponse {
  items: FeedCard[];
  nextCursor: string | null;
}

export interface CuratorProfileCluster {
  id: string;
  title: string;
  publishedAt: string;
  publicItemCount: number;
  coverUrl: string | null;
}

export interface CuratorProfile {
  displayName: string;
  handle: string;
  followerCount: number;
  clusters: CuratorProfileCluster[];
}

export interface FollowResponse {
  following: boolean;
  followerCount: number;
}

export interface InviteView {
  workspaceName: string;
  email: string;
  displayName: string;
}

export interface InviteCreated {
  id: string;
  email: string;
  displayName: string;
}

export interface OffboardResponse {
  email: string;
  revoked: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  from?: ClusterStatus;
  to?: ClusterStatus;
  version?: number;
  entryIds?: string[];
  errors?: Record<string, string>;
  retryAfter?: number;
}
