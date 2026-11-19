// Shared domain types used by both server and client.

export type Role = 'ops_lead' | 'designer' | 'follower';

export interface WorkspaceRef {
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
  role: Role;
  workspaces: WorkspaceRef[];
}

export type ReferenceKind = 'image' | 'clip' | 'still';

export interface Person {
  displayName: string;
  handle: string;
}

export interface Reference {
  id: string;
  kind: ReferenceKind;
  title: string;
  mediaUrl: string;
  createdAt: string;
  createdBy: Person;
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

export type ClusterStatus = 'draft' | 'in_review' | 'embargoed' | 'public' | 'withdrawn';

export interface Entry {
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
  owner: Person;
  itemCount: number;
  version: number;
  timeZone: string;
  liftLocal: string | null;
  liftsAt: string | null;
  publishedAt: string | null;
  entries: Entry[];
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
  curator: Person;
  credits: Person[];
  publishedAt: string;
  publicItemCount: number;
  items: PublicItem[];
}

export interface FeedCard {
  id: string;
  title: string;
  publicDescription: string;
  curator: Person;
  publicItemCount: number;
  publishedAt: string;
  coverUrl: string | null;
}

export interface PlanView {
  plan: string;
  planName: string;
  seatCap: number;
  seatsUsed: number;
  monthlyPrice: string;
  currency: 'USD';
}

export interface UpgradeChoice {
  plan: string;
  planName: string;
  seatCap: number;
  monthlyPrice: string;
}

export interface ApiError {
  error: string;
  message: string;
  errors?: Record<string, string>;
  from?: ClusterStatus;
  to?: ClusterStatus;
  version?: number;
  entryIds?: string[];
  retryAfter?: number;
}

export interface SearchResults {
  query: string;
  counts: { clusters: number; references: number };
  clusters: ClusterSummary[];
  references: Reference[];
}

export interface ClusterList {
  total: number;
  clusters: ClusterSummary[];
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

export interface ReviewPayload {
  cluster: {
    title: string;
    publicDescription: string;
    itemCount: number;
    entries: ReviewEntry[];
  };
  comments: Comment[];
  link: { expiresAt: string; canComment: boolean };
}

export interface ReviewLinkRow {
  id: string;
  email: string;
  expiresAt: string;
  canComment: boolean;
  state: 'live' | 'expired' | 'revoked' | 'inactive';
}

export interface SeatsResponse {
  plan: string;
  seatCap: number;
  seatsUsed: number;
  members: { id: string; displayName: string; email: string; handle: string; hasSeat: boolean }[];
}

export interface WorkspaceResponse {
  slug: string;
  name: string;
  timeZone: string;
  plan: string;
  planName: string;
  seatCap: number;
  seatsUsed: number;
}
