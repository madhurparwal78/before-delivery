// Shared client types matching the server's projections.
export interface Me {
  id: string;
  display_name: string;
  email: string;
  role: string;
  company_slug: string | null;
  unlocked: boolean;
  company_id?: string | null;
}

export interface Review {
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
  reply: { company_name: string; body: string; posted_month: string } | null;
}

export interface PayRow {
  role_family: string;
  role_name: string;
  city: string;
  city_name: string;
  report_count: number;
  threshold: number;
  band: { low: number; median: number; high: number } | null;
}

export interface InterviewNote {
  id: string;
  role_family: string;
  role_name: string;
  difficulty: number;
  outcome: string;
  text: string;
  truncated: boolean;
  posted_month: string;
  author_label: string;
}

export interface Company {
  slug: string;
  name: string;
  city: string;
  city_name: string;
  size: string;
  verified: boolean;
  mark_url: string | null;
  viewer_unlocked: boolean;
  rating: {
    overall: number | null;
    work_life: number | null;
    pay: number | null;
    management: number | null;
    review_count: number;
  };
  reviews: Review[];
  pay_rows: PayRow[];
  interview_notes: InterviewNote[];
  jobs: JobSummary[];
}

export interface JobSummary {
  id: string;
  title: string;
  company_name: string;
  company_slug: string;
  city: string;
  city_name: string;
  role_family: string;
  remote: string;
  pay_low: number;
  pay_high: number;
  pay_band: string;
  listed_at: number | null;
}

export interface JobDetail extends JobSummary {
  description: string;
  status: string;
}

export interface CompanyHit {
  slug: string;
  name: string;
  city: string;
  city_name: string;
  size: string;
  verified: boolean;
  rating: number | null;
  review_count: number;
  pay_report_count: number;
}

export interface MyPost {
  id: string;
  kind: string;
  label: string;
  company_name: string;
  state: string;
  reason: string | null;
  posted_month: string;
  editable: boolean;
}

export interface QueuePost {
  id: string;
  kind: string;
  label: string;
  company_name: string;
  posted_month: string;
  state: string;
  claimed_by_name: string | null;
  claimed_by_you: boolean;
  overall?: number | null;
  work_life?: number | null;
  pay?: number | null;
  management?: number | null;
  pros?: string | null;
  cons?: string | null;
  role_family?: string | null;
  city?: string | null;
  annual_pay?: number | null;
  years_experience?: number | null;
  difficulty?: number | null;
  outcome?: string | null;
  text?: string | null;
}

export interface Applicant {
  id: string;
  job_id: string;
  candidate_name: string;
  contact_email: string;
  phone: string;
  cover_note: string;
  stage: string;
  applied_on: string;
  updated_on: string;
  resume_file_id: string;
}

export interface MyApplication {
  id: string;
  job_id: string;
  job_title: string;
  company_name: string;
  stage: string;
  applied_on: string;
  updated_on: string;
  candidate_name?: string;
  contact_email?: string;
  phone?: string;
  cover_note?: string;
  resume_file_id?: string;
}

export interface Alert {
  id: string;
  label: string;
  new_count: number;
}

export interface ChannelPost {
  id: string;
  channel_slug: string;
  body: string;
  posted_month: string;
  author_label: string;
  quote: {
    review_id: string;
    company_slug: string;
    title: string;
    excerpt: string;
  } | { removed: true } | null;
}

export interface AlertRow {
  id: string;
  label: string;
  new_count: number;
}

export interface SavedAlert {
  id: string;
  label: string;
  new_count: number;
}

export interface FounderMember {
  id: string;
  display_name: string;
  email: string;
  role: string;
  company_slug: string | null;
}

export interface ThresholdRow {
  company_slug: string;
  role_family: string;
  city: string;
  report_count: number;
  threshold: number;
  shown: boolean;
}
