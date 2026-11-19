// The API's shapes as the client reads them (brief: API > Shapes).
import type { FrameRate } from "./timecode.js";
import type { Status } from "./lifecycle.js";

export type { Status };

export type Role = "ops_lead" | "designer" | "follower";
export type LinkState = "live" | "expired" | "revoked" | "inactive";
export type PlanId = "rushes-pro-5" | "rushes-pro-10" | "rushes-pro-25";

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

export interface Person {
  displayName: string;
  handle: string;
}

export interface Reference {
  id: string;
  kind: "image" | "clip" | "still";
  title: string;
  mediaUrl: string;
  createdAt: string;
  createdBy: Person;
  frameRate: FrameRate | null;
  durationMs: number | null;
  totalFrames: number | null;
  sourceClipId: string | null;
  sourceClipTitle: string | null;
  frameIndex: number | null;
  timecode: string | null;
}

export interface ReferencePage {
  items: Reference[];
  nextCursor: string | null;
}

export interface ClusterSummary {
  id: string;
  title: string;
  status: Status;
  itemCount: number;
}

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
  status: Status;
  owner: Person;
  itemCount: number;
  version: number;
  timeZone: string;
  liftLocal: string | null;
  liftsAt: string | null;
  publishedAt: string | null;
  entries: Entry[];
}

export interface EntryResult {
  entry: { id: string; position: number; isPrivate: boolean };
  itemCount: number;
  version: number;
}

export interface PluckResult {
  reference: Reference;
  entry: { id: string; position: number; isPrivate: boolean };
  cluster: { id: string; itemCount: number; version: number };
}

export interface MoveResult {
  version: number;
  entryIds: string[];
}

export interface Comment {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ReviewLink {
  id: string;
  email: string;
  expiresAt: string;
  canComment: boolean;
  state: LinkState;
}

export interface SearchResult {
  query: string;
  counts: { clusters: number; references: number };
  clusters: ClusterSummary[];
  references: Reference[];
}

export interface Member {
  id: string;
  displayName: string;
  email: string;
  handle: string;
  hasSeat: boolean;
}

export interface Roster {
  plan: PlanId;
  seatCap: number;
  seatsUsed: number;
  members: Member[];
}

export interface SeatResult {
  memberId: string;
  seatsUsed: number;
  seatCap: number;
}

export interface Upgrade {
  plan: PlanId;
  planName: string;
  seatCap: number;
  monthlyPrice: string;
}

export interface PlanView {
  plan: PlanId;
  planName: string;
  seatCap: number;
  seatsUsed: number;
  monthlyPrice: string;
  currency: "USD";
  upgrades: Upgrade[];
}

export interface UpgradeResult extends Omit<PlanView, "upgrades"> {
  receiptSentTo: string;
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

export interface FeedPage {
  items: FeedCard[];
  nextCursor: string | null;
}

export interface PublicItem {
  id: string;
  position: number;
  title: string;
  kind: Reference["kind"];
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

export interface Curator {
  displayName: string;
  handle: string;
  followerCount: number;
  clusters: Array<{ id: string; title: string; publishedAt: string; publicItemCount: number; coverUrl: string | null }>;
}

export interface FollowResult {
  following: boolean;
  followerCount: number;
}

export interface ReviewView {
  cluster: { title: string; publicDescription: string; itemCount: number; entries: Array<PublicItem & { isPrivate: boolean }> };
  comments: Comment[];
  link: { expiresAt: string; canComment: boolean };
}

export interface InviteView {
  workspaceName: string;
  email: string;
  displayName: string;
}

export interface ErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  from?: Status;
  to?: string;
  version?: number;
  entryIds?: string[];
  retryAfter?: number;
}
