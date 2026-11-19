// The JSON shapes the API publishes, shared by the server that builds them and the browser that renders them.

export const CATEGORIES = ["inner_awareness", "action", "form", "context"] as const;
export type Category = (typeof CATEGORIES)[number];

export type CohortPhase = "draft" | "enrolling" | "baseline" | "technique" | "closed";
export type EnrollmentStatus = "pending_payment" | "active" | "refunded";
export type ReceiptStatus = "none" | "pending" | "sent";
export type Technique = "none" | "mild" | "ssild";
type Role = "dreamer" | "coach";

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

export interface Enrollment {
  id: string;
  cohort_id: string;
  cohort_name: string;
  name: string;
  email: string;
  status: EnrollmentStatus;
  price_cents: number;
  home_tz: string;
  bedtime: string;
  wake_alarm: string;
  first_night: string | null;
  receipt_status: ReceiptStatus;
}

export interface Memo {
  content_type: string;
  size_bytes: number;
  duration_ms: number;
}

export interface DreamSign {
  id: string;
  entry_id: string;
  start: number;
  end: number;
  phrase: string;
  category: Category;
  night_key: string;
}

export interface EntryFields {
  title: string;
  text: string;
  dreams_recalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: Technique;
  technique_minutes: number;
}

export interface Entry extends EntryFields {
  id: string;
  night_key: string;
  night_number: number;
  late_recall: boolean;
  shared: boolean;
  created_at: string;
  memo: Memo | null;
  signs: DreamSign[];
}

export type Tallies = Record<Category, number>;

export interface Constellation {
  category: Category;
  stars: number;
  tagged_nights: number;
  halo_px: number;
}

export interface Dreamscape {
  constellations: Constellation[];
  target_category: Category | null;
}

export interface NightStatus {
  night_key: string;
  night_number: number;
  first_night: string;
  capture_window: "open" | "closed";
  bedtime: string;
  wake_alarm: string;
  home_tz: string;
  technique_unlocked: boolean;
  cohort_phase: CohortPhase;
}

export interface NightSettings {
  home_tz: string;
  bedtime: string;
  wake_alarm: string;
  night_key: string;
  night_number: number;
  night_held: boolean;
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
  status: EnrollmentStatus;
  night_number: number;
  nights_logged: number;
  recall_rate: number;
  technique_minutes: number;
  wbtb_nights: number;
  reality_checks: number;
  sign_tallies: Tallies;
  shared_entries: SharedEntry[];
}


export interface Session {
  role: Role;
  name: string;
  /** The dreamer's enrollment id or the coach's id. */
  id: string;
}

export function isCategory(value: unknown): value is Category {
  return CATEGORIES.some((category) => category === value);
}
