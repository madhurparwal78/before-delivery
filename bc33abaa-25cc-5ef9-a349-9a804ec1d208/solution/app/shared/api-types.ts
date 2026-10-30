// Response shapes from the API section, shared by server and browser.
import type { Graph, Operation } from "./graph.js";

export type Role = "owner" | "admin" | "billing_manager" | "editor" | "viewer";
export type Scope = "read" | "edit";
type AuthorKind = "member" | "agent" | "system";
export interface Author { kind: AuthorKind; id: string; name: string }
export interface Member { id: string; name: string; email: string; role: Role; joinedAt: string }
export interface WorkspaceSummary { id: string; name: string; timeZone: string }
export interface Workspace extends WorkspaceSummary { reviewLinksEnabled: boolean }

export type SubscriptionState = "trial" | "active" | "past_due" | "suspended" | "cancelled";
export type Plan = "team" | "business";
export type Period = "monthly" | "annual";
export interface PendingChange { plan: Plan; period: Period; extraSeats: number; effectiveAt: string }
export interface Subscription {
  state: SubscriptionState; plan: Plan; period: Period; seatsPurchased: number; extraSeats: number;
  trialEndsAt: string | null; graceEndsAt: string | null; pendingChange: PendingChange | null;
}

export interface Op {
  seq: number; batchId: string; type: Operation["type"]; payload: Operation["payload"]; inverse: Operation;
  author: Author; createdAt: string; undoOf: string | null; redoOf: string | null; restoreTo: number | null;
}
export interface Lock { nodeId: string; holder: Author; expiresAt: string }
export type VersionState = "draft" | "in_review" | "scheduled" | "published" | "withdrawn";
export interface Version {
  id: string; sceneId: string; number: number; label: string; state: VersionState; seq: number; createdBy: Author;
  approvals: { member: Author; at: string }[]; publishAt: string | null; publishedAt: string | null; embedId: string | null;
}
export interface Invoice { id: string; number: string; date: string; amountCents: number; balanceCents: number; status: "paid" | "unpaid"; pdfAvailable: boolean }
export interface Payment { id: string; invoiceId: string; amountCents: number; refundedCents: number; createdAt: string }
export interface BatchResult { batchId: string; firstSeq: number; lastSeq: number; latestSeq: number; hash: string }
export interface Comment {
  id: string; nodeId: string; body: string; author: Author; mentions: { id: string; name: string }[]; resolved: boolean; createdAt: string;
}
export interface Presence { author: Author; selection: string | null }
export interface Asset { id: string; kind: "model" | "texture"; name: string; bytes: number; contentType: string; uploadedBy: Author }
export interface PublishedPayload { scene: { name: string }; version: { number: number; label: string; publishedAt: string }; graph: Graph }
export interface ReviewPayload { scene: { name: string }; version: { number: number; label: string; state: VersionState }; graph: Graph }
export interface Dashboard {
  seatsUsed: number; seatsPurchased: number; scenes: number; publishedScenes: number; scheduledVersions: number;
  activeAgentTokens: number; subscription: Subscription;
}
