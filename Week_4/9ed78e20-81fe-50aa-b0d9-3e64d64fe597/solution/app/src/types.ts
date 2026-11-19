export type Role = "editor" | "approver" | "recruiter" | "administrator";
export type ContentStatus =
  | "draft"
  | "in_review"
  | "returned"
  | "approved"
  | "scheduled"
  | "published"
  | "withdrawn";
export interface Claim {
  id: string;
  text: string;
  benchmark: string;
  eval_date: string;
  comparator: string;
  stated_delta: string;
}
export interface Comment {
  id: string;
  author: string;
  body: string;
  created_at: string;
}
export interface Content {
  id: string;
  kind: "model" | "news";
  slug: string;
  title: string;
  summary: string;
  body: string;
  subject: string | null;
  tags: string[] | null;
  claims: Claim[] | null;
  linked_news_slug: string | null;
  status: ContentStatus;
  version: number;
  author: string;
  comments: Comment[];
  release_at: string | null;
  release_at_local: string | null;
  published_at: string | null;
  read_time_minutes: number | null;
  zone?: string;
}
export interface Signoff {
  by: string;
  at: string;
  note: string;
}
export interface ReleaseRecord {
  status:
    | "open"
    | "safety_signed"
    | "legal_signed"
    | "signed"
    | "claims_validated"
    | "cleared";
  safety: Signoff | null;
  legal: Signoff | null;
  claims_validated_at: string | null;
  cleared_by: string | null;
  cleared_at: string | null;
  last_validation: { claim: string; ok: boolean; reason: string }[] | null;
}
export interface BenchmarkRow {
  id: string;
  subject: string;
  subject_name: string;
  organisation: string;
  benchmark: string;
  eval_date: string;
  score: string;
  source_note: string;
}
export interface Grant {
  id: string;
  staff_email: string;
  role: Role;
  granted_by: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  version: number;
  status?: "active" | "expired" | "revoked";
}
export interface Staff {
  email: string;
  name: string;
  roles: { role: Role; expires_at: string }[];
}
export interface Requisition {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "open" | "closed";
  discipline: string;
  office: string;
  description: string;
  recruiters: string[];
  opened_at: string | null;
  closed_at: string | null;
  erase_after: string | null;
  version: number;
}
export type Stage =
  | "submitted"
  | "screening"
  | "interview"
  | "final_review"
  | "offer"
  | "declined"
  | "withdrawn";
export interface StageDecision {
  from: Stage;
  to: Stage;
  rationale: string;
  by: string;
  at: string;
}
export interface Application {
  id: string;
  requisition_id: string;
  reference: string;
  name: string;
  email: string;
  stage: Stage;
  version: number;
  submitted_at: string;
  stage_changed_at: string;
  decisions: StageDecision[];
  notes: { id: string; body: string; by: string; at: string }[];
  resume_key: string;
  token_digest: string | null;
  token_ciphertext: string | null;
  receipt: ApplicationReceipt;
  erased: boolean;
}
export interface ApplicationReceipt {
  application: {
    reference: string;
    role: { slug: string; title: string };
    stage: "submitted";
    submitted_at: string;
  };
}
export interface Benefits {
  id: string;
  region: string;
  effective_from: string;
  summary: string;
}
export interface AuditEntry {
  seq: number;
  id: string;
  at: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}
export type JobKind = "mail" | "resume_erase" | "sample_upload";
export interface Job {
  id: number;
  kind: JobKind;
  state: "pending" | "running" | "done" | "dead";
  attempts: number;
  refusals: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  finished_at: string | null;
}
export interface MailMessage {
  to_name: string;
  to_email: string;
  subject: string;
  body: string;
}
export interface SearchItem {
  kind: "model" | "news" | "role";
  slug: string;
  title: string;
  url: string;
  published_at: string;
  rank: number;
  highlight: string;
}
export interface SearchPage {
  query: string;
  kind: string | null;
  items: SearchItem[];
  next_cursor: string | null;
}
export interface PublicClaim {
  id: string;
  number: number;
  text: string;
  benchmark: string;
  eval_date: string;
  model_row_id: string;
  comparator_row_id: string;
  delta: string;
}
export interface Sample {
  id: string;
  kind: "audio" | "image_sequence";
  title: string;
  urls: string[];
}
export type PublicBenchmarkRow = Omit<BenchmarkRow, "source_note">;
export interface ModelRoute {
  slug: string;
  title: string;
  summary: string;
  published_at: string;
  read_time_minutes: number;
  organisation: string;
  sections: { id: string; heading: string }[];
  body: string;
  claims: PublicClaim[];
  rows: PublicBenchmarkRow[];
  samples: Sample[];
  samples_available?: boolean;
  linked_news: { slug: string; title: string } | null;
  as_of?: string;
}
export interface NewsPost {
  slug: string;
  title: string;
  summary: string;
  subject: string;
  tags: string[];
  published_at: string;
  read_time_minutes: number;
  body?: string;
  linked_model?: { slug: string; title: string } | null;
  as_of?: string;
}
export interface Tracking {
  role: { title: string; office: string };
  stage: Stage;
  stage_label: string;
  submitted_at: string;
  stage_changed_at: string;
}
export interface Home {
  theses: { number: number; heading: string; body: string }[];
  rail: {
    kind: "model" | "news";
    slug: string;
    title: string;
    published_at: string;
    url: string;
  }[];
}
export interface Newsroom {
  items: NewsPost[];
  facets: {
    subjects: { value: string; label: string; count: number }[];
    tags: { value: string; count: number }[];
  };
  page: number;
  pages: number;
  total: number;
  as_of?: string;
}
export interface PublicRole {
  slug: string;
  title: string;
  discipline: string;
  office: string;
  office_label: string;
  region: string;
  region_label: string;
  opened_at: string;
  description?: string;
  benefits?: Pick<Benefits, "id" | "effective_from" | "summary"> | null;
}
