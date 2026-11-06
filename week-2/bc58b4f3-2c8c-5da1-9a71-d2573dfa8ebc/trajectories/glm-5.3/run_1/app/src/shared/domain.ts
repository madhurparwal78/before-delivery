export type Role = "scheduler" | "org_admin" | "dispatcher" | "billing_lead" | "interpreter";

export const AGENCY_TZ = "America/Chicago";

export const SETTINGS = ["hospital", "clinic", "school"] as const;
export type Setting = (typeof SETTINGS)[number];

export type AssignmentStatus =
  | "draft"
  | "released"
  | "partially_covered"
  | "covered"
  | "served"
  | "verified"
  | "invoiced"
  | "cancelled";

export type SeatStatus = "open" | "held" | "served";

export type BillingStatus = "none" | "ready" | "queued" | "posted";

export interface LangSeed {
  code: string;
  name: string;
}

export const LANGUAGES: readonly LangSeed[] = [
  { code: "asl", name: "ASL" },
  { code: "es", name: "Spanish" },
  { code: "vi", name: "Vietnamese" },
  { code: "so", name: "Somali" },
  { code: "ar", name: "Arabic" },
];

export const STATUS_LABELS: Record<AssignmentStatus, string> = {
  draft: "Awaiting release",
  released: "Open",
  partially_covered: "Partly covered",
  covered: "Covered",
  served: "Served",
  verified: "Verified",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

export interface SeatView {
  seat: number;
  status: SeatStatus;
  interpreter_initials: string | null;
}

export interface CancellationView {
  cancelled_at: string;
  fee_applies: boolean;
  business_minutes_notice: number;
  fee_cents: number;
}

export interface BillingView {
  status: BillingStatus;
  invoice_id: string | null;
  total_cents: number;
}

export interface OfferAssignmentView {
  number: string;
  status: AssignmentStatus;
  language: string;
  setting: Setting;
  city: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  seats: { seat: number; status: SeatStatus }[];
}

export interface HolderAssignmentView extends OfferAssignmentView {
  street_address: string;
  patient_initials: string;
  medical_notes: string;
  scheduler: { name: string; phone: string };
  seats: SeatView[];
}

export interface OrgAssignmentView extends HolderAssignmentView {
  cancellation: CancellationView | null;
  billing: BillingView;
}

export interface StaffAssignmentView extends OrgAssignmentView {
  org: { code: string; name: string };
  seats: (SeatView & { interpreter_name: string | null })[];
}

export type AssignmentView = OfferAssignmentView | HolderAssignmentView | OrgAssignmentView | StaffAssignmentView;

export interface MeUser {
  id: number;
  name: string;
  role: Role;
  initials: string | null;
  org: { code: string; name: string } | null;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export function serviceLineOf(language: string): "asl" | "spoken" {
  return language === "asl" ? "asl" : "spoken";
}

export function seatCountFor(language: string, durationMinutes: number): number {
  return language === "asl" && durationMinutes > 60 ? 2 : 1;
}
