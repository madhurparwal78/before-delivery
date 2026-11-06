import type { AssetKind, CertState, Role, Tag, Transform } from './domain';

export interface UserRef {
  id: string;
  name: string;
}
export interface TermRef {
  id: string;
  name: string;
}
export interface FacetEntry {
  value: string;
  label: string;
  count: number;
}
export interface AssetSummary {
  id: string;
  kind: AssetKind;
  description: string;
  owner: UserRef;
  state: CertState;
  terms: TermRef[];
  tagged_column_count: number;
  pii_column_count: number;
  confidential_column_count: number;
  deprecated_upstream: string | null;
}
export interface EvidenceInfo {
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_at: string;
  uploaded_by: UserRef;
}
export interface DeprecationInfo {
  reason: string;
  at: string;
  by: UserRef;
}
export interface ColumnBody {
  id: string;
  name: string;
  data_type: string;
  direct_tags: Tag[];
  effective_tags: Tag[];
  suppressed_tags: Tag[];
  tag_sources: Record<Tag, string[]>;
  samples: string[];
  masked: boolean;
}
export interface AssetDetail extends AssetSummary {
  verified_at: string | null;
  evidence: EvidenceInfo | null;
  deprecation: DeprecationInfo | null;
  columns: ColumnBody[];
}
export interface TermBody {
  id: string;
  name: string;
  definition: string;
  revision: number;
  assets: Array<{ id: string }>;
}
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface AuditRow {
  id: string;
  seq: number;
  at: string;
  actor: UserRef;
  actor_role: Role;
  action: string;
  target: { type: string; id: string };
  before: unknown;
  after: unknown;
  prev_hash: string;
  hash: string;
}
export interface GraphColumn {
  id: string;
  asset: string;
  direct_tags: Tag[];
  effective_tags: Tag[];
  suppressed_tags: Tag[];
  tag_sources: Record<Tag, string[]>;
}
export interface GraphEdgeBody {
  id: string;
  from: string;
  to: string;
  transform: Transform;
}
export interface LineageReachedEntry {
  column: string;
  asset: string;
  hop: number;
  carried_tags: Tag[];
  sealed_tags: Tag[];
  tag_sources: Partial<Record<Tag, string[]>>;
}
export interface LineageEdgeBody {
  from: string;
  to: string;
  transform: Transform;
  kind: 'flow' | 'seal' | 'cycle';
}
export interface LineageBody {
  focus: string;
  direction: 'downstream' | 'upstream';
  focus_tags: Tag[];
  focus_tag_sources: Record<Tag, string[]>;
  reached: LineageReachedEntry[];
  edges: LineageEdgeBody[];
  cycles: Array<{ from: string; to: string }>;
  assets: Record<string, { state: CertState; deprecated_upstream: string | null }>;
  totals: { columns: number; hops: number; cycles: number };
  truncated: boolean;
  limits: { max_hops: number; max_columns: number };
  summary: string;
}
export interface ApiErrorShape {
  error: { code: string; message: string };
}
export interface ValidationBody extends ApiErrorShape {
  error: { code: 'validation'; message: string; fields?: Record<string, string> };
}
export interface SearchResponse {
  results: AssetSummary[];
  total: number;
  facets: { tag: FacetEntry[]; owner: FacetEntry[]; state: FacetEntry[]; term: FacetEntry[] };
  as_of_seq?: number;
  as_of_at?: string | null;
}
export interface AssetReadResponse {
  as_of_seq?: number;
  as_of_at?: string | null;
  asset: AssetDetail;
}
export interface ColumnReadResponse extends ColumnBody {
  asset: { id: string; state: CertState };
  as_of_seq?: number;
  as_of_at?: string | null;
}
export interface StatusResponse {
  evidence: 'up' | 'down';
  mail: 'up' | 'down';
  queued_notices: number;
}
export interface ChainResponse {
  intact: boolean;
  checked_through: number;
  first_broken_seq: number | null;
}
export interface BulkTagResponse {
  batch_id: string | null;
  tag: Tag;
  requested: number;
  applied: number;
  results: Array<{ column: string; outcome: 'applied' | 'already_present' | 'refused'; error: { code: string; message: string } | null }>;
  columns: ColumnBody[];
  changed_columns: string[];
}
export interface TagMutationResponse {
  column: ColumnBody;
  changed_columns: string[];
}
export interface WithdrawResponse extends TagMutationResponse {
  still_reaching: number;
}
export interface UndoResponse {
  batch_id: string;
  restored: number;
  columns: ColumnBody[];
  changed_columns: string[];
}
export interface DeprecateResponse {
  asset: AssetDetail;
  notices_queued: number;
  queued_notices: number;
}
export interface ReinstateResponse {
  asset: AssetDetail;
  notices_cancelled: number;
  queued_notices: number;
}
export interface AuditListResponse {
  rows: AuditRow[];
  total: number;
  next_before_seq: number | null;
}
export interface EventData {
  seq: number;
  action: string;
  target: { type: string; id: string };
}
