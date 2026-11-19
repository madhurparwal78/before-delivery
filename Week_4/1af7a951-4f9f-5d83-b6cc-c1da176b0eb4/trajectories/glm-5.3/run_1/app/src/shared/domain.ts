export type CohortPhase = 'draft' | 'enrolling' | 'baseline' | 'technique' | 'closed';
export type EnrolmentStatus = 'pending_payment' | 'active' | 'refunded';
export type SignCategory = 'inner_awareness' | 'action' | 'form' | 'context';
export type Technique = 'none' | 'mild' | 'ssild';
export type Role = 'dreamer' | 'coach';

export const SIGN_CATEGORIES: readonly SignCategory[] = ['inner_awareness', 'action', 'form', 'context'] as const;

export interface Cohort {
  id: string;
  name: string;
  coach_name: string;
  starts_on: string;
  phase: CohortPhase;
  week: number | null;
  price_cents: number;
  seats: number;
  seats_left: number;
}

export interface Enrolment {
  id: string;
  cohort_id: string;
  cohort_name: string;
  name: string;
  email: string;
  status: EnrolmentStatus;
  price_cents: number;
  home_tz: string;
  bedtime: string;
  wake_alarm: string;
  first_night: string | null;
  receipt_status: 'none' | 'pending' | 'sent';
}

export interface Sign {
  id: string;
  entry_id: string;
  start: number;
  end: number;
  phrase: string;
  category: SignCategory;
  night_key: string;
}

export interface MemoInfo {
  content_type: string;
  size_bytes: number;
  duration_ms: number;
}

export interface Entry {
  id: string;
  night_key: string;
  night_number: number;
  title: string;
  text: string;
  dreams_recalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: Technique;
  technique_minutes: number;
  late_recall: boolean;
  shared: boolean;
  created_at: string;
  memo: MemoInfo | null;
  signs: Sign[];
}

export interface Tallies {
  inner_awareness: number;
  action: number;
  form: number;
  context: number;
}

export interface SharedEntry {
  entry_id: string;
  night_key: string;
  title: string;
  text: string;
  has_memo: boolean;
}

export interface RosterRow {
  enrollment_id: string;
  display_name: string;
  status: EnrolmentStatus;
  night_number: number;
  nights_logged: number;
  recall_rate: number;
  technique_minutes: number;
  wbtb_nights: number;
  reality_checks: number;
  sign_tallies: Tallies;
  shared_entries: SharedEntry[];
}

export interface SessionPayload {
  role: Role;
  name: string;
  id: string;
}

export interface Constellation {
  category: SignCategory;
  stars: number;
  tagged_nights: number;
  halo_px: number;
}
