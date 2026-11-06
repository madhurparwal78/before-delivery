// The JSON shapes of the API (brief: Backend › API › Shapes), shared by the server and the client.
import type { FeatureStatus, NoteStatus, ReleaseStatus } from "./lifecycles.js";

export type Role = "head_of_product" | "product_manager" | "customer_success";
export type Importance = "nice_to_have" | "important" | "critical";
export type NoteSource = "support_ticket" | "sales_call" | "email" | "csv_import";

export interface User { id: string; name: string; email: string; role: Role }
export interface Workspace { id: string; name: string; timeZone: string }
export interface Me { user: User; workspace: Workspace }

export interface Attachment { id: string; filename: string; contentType: string; size: number; status: "available" | "pending" }

export interface Insight {
  id: string; noteId: string; featureId: string; featureName: string;
  start: number; end: number; quote: string; importance: Importance; companyId: string | null;
}

export interface Note {
  id: string; title: string; body: string; text: string; source: NoteSource; status: NoteStatus;
  snoozedUntil: string | null; receivedOn: string | null; createdAt: string;
  contact: { id: string; name: string; email: string } | null;
  company: { id: string; name: string } | null;
  attachments: Attachment[]; insights: Insight[];
}

export interface NoteListItem {
  id: string; title: string; source: NoteSource; status: NoteStatus; snoozedUntil: string | null;
  contactName: string | null; companyName: string | null; createdAt: string; insightCount: number;
}

export interface NoteCounts { unprocessed: number; snoozed: number; processed: number }
export interface NotePage { notes: NoteListItem[]; nextCursor: string | null; counts: NoteCounts }

export interface FeatureSummary {
  id: string; name: string; publicDescription: string; componentId: string; status: FeatureStatus;
  releaseId: string | null; insightCount: number; companyCount: number; impact: number;
  effort: number; confidence: number; fits: Record<string, number>; objectiveFit: number; priority: number;
  rank: number | null; rankTotal: number; version: number;
}

export interface SubfeatureRef { id: string; name: string; status: FeatureStatus }
export interface ScoreVersion {
  version: number; effort: number; confidence: number; fits: Record<string, number>;
  priority: number; savedAt: string; savedBy: string | null;
}

export interface FeatureDetail extends FeatureSummary {
  requestedBy: { companyId: string; companyName: string; insightCount: number }[];
  insights: Insight[];
  subfeatures: SubfeatureRef[];
  scoreVersions: ScoreVersion[];
}

export interface InsightChange { feature: FeatureSummary; before: { impact: number; priority: number; rank: number | null } }

export interface HierarchyFeature extends FeatureSummary { subfeatures: SubfeatureRef[] }
export interface Hierarchy {
  products: { id: string; name: string; components: { id: string; name: string; features: HierarchyFeature[] }[] }[];
}

export interface Objective { id: string; name: string; weight: number }

export interface Release {
  id: string; name: string; targetDate: string; targetMonth: string; status: ReleaseStatus; isPublic: boolean;
  orderVersion: number; snapshotVersion: number | null; featureIds: string[]; shippedAt: string | null;
  emails: { queued: number; sent: number };
}

export interface BoardRelease extends Release { features: { id: string; name: string; status: FeatureStatus; position: number }[] }
export interface Roadmap {
  timeZone: string;
  unscheduled: { id: string; name: string; status: FeatureStatus }[];
  columns: { month: string; label: string; releases: BoardRelease[] }[];
}
export interface ReleaseOrder { releaseId: string; orderVersion: number; featureIds: string[] }

export interface ShareLink {
  id: string; token: string; url: string; createdAt: string; expiresInSeconds: number | null;
  expiresAt: string | null; revokedAt: string | null; status: "active" | "expired" | "revoked";
}

export interface PublicRoadmap {
  columns: { month: string; label: string; releases: { name: string; targetMonth: string; features: { name: string; publicDescription: string }[] }[] }[];
}

export interface Company {
  id: string; name: string; domains: string[];
  contacts: { id: string; name: string; email: string }[];
  noteCount: number;
}

export interface CompanyRequest {
  featureId: string; featureName: string; status: FeatureStatus;
  releaseName: string | null; targetMonth: string | null; shipped: boolean;
}
export interface CompanyDetail extends Company { requests: CompanyRequest[]; notes: { id: string; title: string; createdAt: string }[] }

export interface SearchResults {
  notes: { id: string; title: string; snippet: string }[];
  companies: { id: string; name: string; domains: string[] }[];
  features: { id: string; name: string; insightCount: number; companyCount: number }[];
}

export type ImportOutcome = "created" | "matched" | "skipped";
export type SkipReason = "missing_email" | "invalid_email" | "missing_feedback" | "invalid_date" | "duplicate";
export interface ImportReport {
  dryRun: boolean;
  totals: { rows: number; created: number; matched: number; skipped: number; notes: number; companiesCreated: number };
  rows: { line: number; outcome: ImportOutcome; reason: SkipReason | null; noteId: string | null }[];
}

export interface Invitation { id: string; email: string; role: Role; expiresAt: string }
export interface InvitationInfo { email: string; role: Role; workspaceName: string }

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; [extra: string]: unknown };
}
