export type Role = 'learner' | 'coordinator' | 'planner' | 'author';
export type CourseState = 'draft' | 'in_review' | 'published' | 'withdrawn';
export type EnrolmentState = 'held' | 'confirmed' | 'completed' | 'certified' | 'refunded' | 'withdrawn';
export type Funding = 'card' | 'co_pay' | 'seat';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  organisation: { id: string; name: string; kind: 'provider' | 'hospital' } | null;
  licence_number?: string | null;
  date_of_birth?: string | null;
}

export interface CourseModule {
  id: string;
  position: number;
  title: string;
  minutes: number;
  kind: 'lesson' | 'evaluation';
  body?: string | null;
  question?: { prompt: string; options: string[]; answer_index: number } | null;
}

export interface Cohort {
  id: string;
  course_id: string;
  name: string;
  starts_on: string;
  close_date: string;
  closes_at: string;
  seat_cap: number;
  seats_remaining: number;
  open: boolean;
  roster?: { enrolment_id: string; nurse_name: string; state: string }[];
  waitlist?: { position: number; nurse_name: string; joined_at: string }[];
}

export interface Course {
  id: string;
  title: string;
  summary: string;
  format: 'self_paced' | 'cohort';
  state: CourseState;
  list_price: string;
  total_minutes: number;
  contact_hours: string;
  version: number;
  author: { id: string; display_name: string };
  modules?: CourseModule[];
  cohorts?: Cohort[];
}

export interface Quote {
  list_price: string;
  employer_share: string;
  learner_share: string;
  coverage_percent: string;
  sponsor: string | null;
}

export interface Enrolment {
  id: string;
  course_id: string;
  course_title: string;
  cohort_id: string | null;
  state: EnrolmentState;
  funding: Funding;
  assignment_id: string | null;
  list_price: string;
  employer_share: string;
  learner_share: string;
  enrolled_at: string;
  verified_minutes: number;
  total_minutes: number;
  progress_percent: number;
  certificate_id: string | null;
  modules: { id: string; title: string; minutes: number; kind: 'lesson' | 'evaluation'; status: 'verified' | 'unverified' }[];
}

export interface CertificateVersion {
  version: number;
  state: 'sealing' | 'sealed' | 'reissued' | 'revoked';
  sealed_on: string | null;
  nurse_name: string;
}

export interface Certificate {
  id: string;
  serial: string;
  state: 'sealing' | 'sealed' | 'revoked';
  version: number;
  reissue_pending: boolean;
  nurse_name: string;
  course_title: string;
  contact_hours: string;
  issued_on: string | null;
  enrolment_id: string;
  verified_module_count: number;
  versions: CertificateVersion[];
}

export interface ShareLink {
  id: string;
  url: string;
  state: 'active' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string;
}

export interface Pack {
  id: string;
  course_id: string;
  course_title: string;
  seats_purchased: number;
  balance: number;
  price_total: string;
  purchased_at: string;
  expires_at: string;
  state: 'active' | 'expired';
}

export interface LedgerEntry {
  movement_id: string;
  kind: 'purchase' | 'assignment' | 'return' | 'expiry';
  account: string;
  seats: number;
  assignment_id: string | null;
  posted_at: string;
}

export interface Coverage {
  coverage_percent: string;
  scheduled: { coverage_percent: string; effective_on: string } | null;
}

export interface SponsorDashboard {
  seats_purchased: number;
  seats_assigned: number;
  seats_available: number;
  seats_expired: number;
  completions: number;
  hours_awarded: string;
  coverage: Coverage;
}

export interface LearnerSummary {
  id: string;
  display_name: string;
  email: string;
  seats_held: number;
  hours_completed: string;
}

export interface RefundRequest {
  id: string;
  enrolment_id: string;
  nurse_name: string;
  course_title: string;
  state: 'pending' | 'approved' | 'declined';
  reason: string;
  requested_at: string;
  refund_total: string;
  employer_refund: string;
  learner_refund: string;
  decided_by: { id: string; display_name: string } | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface MonthlyRow {
  month: string;
  completions: number;
  hours: string;
}

export interface CourseHistoryEntry {
  from: CourseState;
  to: CourseState;
  by: { id: string; display_name: string };
  note: string | null;
  at: string;
}

export interface VerificationCertificate {
  serial: string;
  nurse_name: string;
  course_title: string;
  contact_hours: string;
  issued_on: string | null;
  state: 'sealed' | 'revoked';
  provider: string;
  accreditation_statement: string;
}
