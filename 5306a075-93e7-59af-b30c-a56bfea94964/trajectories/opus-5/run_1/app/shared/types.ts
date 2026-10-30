export type Role = 'head_of_product' | 'product_manager' | 'customer_success';

export type NoteSource = 'support_ticket' | 'sales_call' | 'email' | 'csv_import';
export type NoteStatus = 'unprocessed' | 'snoozed' | 'processed';
export type Importance = 'nice_to_have' | 'important' | 'critical';
export type FeatureStatus = 'candidate' | 'planned' | 'in_progress' | 'released' | 'archived';
export type ReleaseStatus = 'open' | 'frozen' | 'shipped';
export type AttachmentStatus = 'available' | 'pending';
export type ShareLinkStatus = 'active' | 'expired' | 'revoked';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Workspace {
  id: string;
  name: string;
  timeZone: string;
}

export interface ContactRef {
  id: string;
  name: string;
  email: string;
}

export interface CompanyRef {
  id: string;
  name: string;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  status: AttachmentStatus;
}

export interface Insight {
  id: string;
  noteId: string;
  featureId: string;
  featureName: string;
  start: number;
  end: number;
  quote: string;
  importance: Importance;
  companyId: string | null;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  text: string;
  source: NoteSource;
  status: NoteStatus;
  snoozedUntil: string | null;
  receivedOn: string | null;
  createdAt: string;
  contact: ContactRef | null;
  company: CompanyRef | null;
  attachments: Attachment[];
  insights: Insight[];
}

export interface NoteListItem {
  id: string;
  title: string;
  source: NoteSource;
  status: NoteStatus;
  snoozedUntil: string | null;
  contactName: string | null;
  companyName: string | null;
  createdAt: string;
  insightCount: number;
}

export interface NoteListResponse {
  notes: NoteListItem[];
  nextCursor: string | null;
  counts: { unprocessed: number; snoozed: number; processed: number };
}

export interface FeatureSummary {
  id: string;
  name: string;
  publicDescription: string;
  componentId: string;
  status: FeatureStatus;
  releaseId: string | null;
  insightCount: number;
  companyCount: number;
  impact: number;
  effort: number;
  confidence: number;
  fits: Record<string, number>;
  objectiveFit: number;
  priority: number;
  rank: number | null;
  rankTotal: number;
  version: number;
}

export interface ScoreVersion {
  version: number;
  effort: number;
  confidence: number;
  fits: Record<string, number>;
  priority: number;
  savedAt: string;
  savedBy: string | null;
}

export interface SubfeatureRef {
  id: string;
  name: string;
  status: FeatureStatus;
}

export interface FeatureDetail extends FeatureSummary {
  requestedBy: { companyId: string; companyName: string; insightCount: number }[];
  insights: Insight[];
  subfeatures: SubfeatureRef[];
  scoreVersions: ScoreVersion[];
}

export interface HierarchyFeature extends FeatureSummary {
  subfeatures: SubfeatureRef[];
}

export interface HierarchyResponse {
  products: {
    id: string;
    name: string;
    components: { id: string; name: string; features: HierarchyFeature[] }[];
  }[];
}

export interface Objective {
  id: string;
  name: string;
  weight: number;
}

export interface Release {
  id: string;
  name: string;
  targetDate: string;
  targetMonth: string;
  status: ReleaseStatus;
  isPublic: boolean;
  orderVersion: number;
  snapshotVersion: number;
  featureIds: string[];
  shippedAt: string | null;
  emails: { queued: number; sent: number };
}

export interface RoadmapRelease extends Release {
  features: { id: string; name: string; status: FeatureStatus; position: number }[];
}

export interface RoadmapResponse {
  timeZone: string;
  unscheduled: { id: string; name: string; status: FeatureStatus }[];
  columns: { month: string; label: string; releases: RoadmapRelease[] }[];
}

export interface Company {
  id: string;
  name: string;
  domains: string[];
  contacts: ContactRef[];
  noteCount: number;
}

export interface CompanyRequest {
  featureId: string;
  featureName: string;
  status: FeatureStatus;
  releaseName: string | null;
  targetMonth: string | null;
  shipped: boolean;
}

export interface CompanyDetail extends Company {
  requests: CompanyRequest[];
}

export interface ShareLink {
  id: string;
  token: string;
  url: string;
  createdAt: string;
  expiresInSeconds: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: ShareLinkStatus;
}

export interface SearchResponse {
  notes: { id: string; title: string; snippet: string }[];
  companies: { id: string; name: string; domains: string[] }[];
  features: { id: string; name: string; insightCount: number; companyCount: number }[];
}

export type ImportOutcome = 'created' | 'matched' | 'skipped';

export interface ImportRow {
  line: number;
  outcome: ImportOutcome;
  reason: string | null;
  noteId: string | null;
}

export interface ImportReport {
  dryRun: boolean;
  totals: {
    rows: number;
    created: number;
    matched: number;
    skipped: number;
    notes: number;
    companiesCreated: number;
  };
  rows: ImportRow[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    insightIds?: string[];
    current?: unknown;
    from?: string;
    to?: string;
  };
}
