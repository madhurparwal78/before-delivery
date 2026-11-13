import type {
  CityId,
  JobStatus,
  OutcomeId,
  PayBandId,
  PostKind,
  PostState,
  Role,
  RoleFamilyId,
  StageId,
  WorkPatternId,
} from "./reference";

export type SessionUser = { id: string; display_name: string; role: Role; unlocked: boolean };
export type Me = SessionUser & { email: string; company_slug: string | null };

export type Rating = {
  overall: number | null;
  work_life: number | null;
  pay: number | null;
  management: number | null;
  review_count: number;
};
export type Reply = { company_name: string; body: string; posted_month: string };
export type Review = {
  id: string;
  title: string;
  overall: number;
  work_life: number;
  pay: number;
  management: number;
  pros: string;
  cons: string;
  truncated: boolean;
  posted_month: string;
  author_label: string;
  reply: Reply | null;
};
export type PayBand = { low: number; median: number; high: number };
export type PayRow = {
  role_family: RoleFamilyId;
  role_name: string;
  city: CityId;
  city_name: string;
  report_count: number;
  threshold: number;
  band: PayBand | null;
};
export type InterviewNote = {
  id: string;
  role_family: RoleFamilyId;
  role_name: string;
  difficulty: number;
  outcome: OutcomeId;
  text: string;
  truncated: boolean;
  posted_month: string;
  author_label: string;
};
export type JobSummary = {
  id: string;
  title: string;
  company_name: string;
  company_slug: string;
  city: CityId;
  city_name: string;
  role_family: RoleFamilyId;
  remote: WorkPatternId;
  pay_low: number;
  pay_high: number;
  pay_band: PayBandId;
  listed_at: string | null;
};
export type JobDetail = JobSummary & { description: string; status: JobStatus };
export type Company = {
  slug: string;
  name: string;
  city: CityId;
  city_name: string;
  size: string;
  verified: boolean;
  mark_url: string | null;
  viewer_unlocked: boolean;
  rating: Rating;
  reviews: Review[];
  pay_rows: PayRow[];
  interview_notes: InterviewNote[];
  jobs: JobSummary[];
};
export type CompanyHit = {
  slug: string;
  name: string;
  city: CityId;
  city_name: string;
  size: string;
  verified: boolean;
  rating: number | null;
  review_count: number;
  pay_report_count: number;
};
export type Facets = Record<string, Record<string, number>>;
export type JobSearch =
  | { fallback?: undefined; total: number; page: number; page_size: number; hits: JobSummary[]; facets: Facets }
  | { fallback: "by_city"; cities: { city: CityId; city_name: string; total: number; jobs: JobSummary[] }[] };
export type CompanySearch =
  | { fallback?: undefined; total: number; page: number; page_size: number; hits: CompanyHit[]; facets: Facets }
  | { fallback: "by_city"; cities: { city: CityId; city_name: string; total: number; companies: CompanyHit[] }[] };

export type MyPost = {
  id: string;
  kind: PostKind;
  label: string;
  company_name: string;
  state: PostState;
  reason: string | null;
  posted_month: string;
  editable: boolean;
  fields: Record<string, string | number>;
};
export type PostCreated = {
  id: string;
  kind: PostKind;
  state: "pending";
  label: string;
  company_name: string;
  posted_month: string;
};

export type QueuePost = {
  id: string;
  kind: PostKind;
  label: string;
  company_name: string;
  posted_month: string;
  state: "pending" | "claimed";
  claimed_by_name: string | null;
  claimed_by_me: boolean;
  history: HistoryEvent[];
  title?: string;
  overall?: number;
  work_life?: number;
  pay?: number;
  management?: number;
  pros?: string;
  cons?: string;
  role_family?: RoleFamilyId;
  role_name?: string;
  city?: CityId;
  annual_pay?: number;
  years_experience?: number;
  difficulty?: number;
  outcome?: OutcomeId;
  text?: string;
};
export type HistoryEvent = {
  type: "claimed" | "renewed" | "expired" | "approved" | "rejected";
  by_name: string | null;
  reason: string | null;
  at: string;
};

export type Applicant = {
  id: string;
  job_id: string;
  candidate_name: string;
  contact_email: string;
  phone: string;
  cover_note: string;
  stage: StageId;
  applied_on: string;
  updated_on: string;
  resume_file_id: string;
};
export type EmployerJob = JobDetail;
export type MyApplication = {
  id: string;
  job_id: string;
  job_title: string;
  company_name: string;
  stage: StageId;
  applied_on: string;
  updated_on: string;
};
export type MyApplicationDetail = MyApplication & {
  candidate_name: string;
  contact_email: string;
  phone: string;
  cover_note: string;
  resume_file_id: string;
};
export type ApplicationCreated = {
  id: string;
  job_id: string;
  stage: "submitted";
  resume_file_id: string;
  applied_on: string;
};

export type AlertRow = { id: string; label: string; new_count: number; search: string };
export type Channel = { slug: string; name: string };
export type ChannelPost = {
  id: string;
  channel_slug: string;
  body: string;
  posted_month: string;
  author_label: string;
  quote: null | { review_id: string; company_slug: string; title: string; excerpt: string } | { removed: true };
};

export type FounderHealth = {
  database: ServiceState;
  search: ServiceState;
  storage: ServiceState;
  mail: ServiceState;
  outbox_pending: number;
  search_sync_pending: number;
};
export type ServiceState = "ok" | "unavailable";
export type MemberRow = {
  id: string;
  display_name: string;
  email: string;
  role: Role;
  company_slug: string | null;
};
export type ThresholdRow = {
  company_slug: string;
  role_family: RoleFamilyId;
  city: CityId;
  report_count: number;
  threshold: number;
  shown: boolean;
};
