// Assignment views mirrored from the shared domain types (the server returns these shapes).
export type {
  Role, Setting, AssignmentStatus, SeatStatus, BillingStatus,
  OfferAssignmentView, HolderAssignmentView, OrgAssignmentView, StaffAssignmentView,
  SeatView, CancellationView, BillingView, MeUser,
} from "../shared/domain";
import { LANGUAGES as LANG_SEED, SETTINGS as SETTING_VALUES, STATUS_LABELS as LABELS } from "../shared/domain";
import type { MeUser } from "../shared/domain";

export { LANG_SEED as LANGUAGES, SETTING_VALUES as SETTINGS, LABELS as STATUS_LABELS };

export interface SessionResponse {
  user: MeUser | null;
}

export interface QueueItem {
  number: string;
  org_code: string;
  kind: "service" | "late_cancellation";
  start_at: string;
  total_cents: number | null;
  billing: { status: string; invoice_id: string | null; total_cents: number | null };
}

export interface RateEntry {
  org: string;
  service_line: string;
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}

export interface CoverageAssignment {
  number: string;
  status: string;
  org_code: string;
  setting: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  seats: { seat: number; status: string; interpreter_initials: string | null }[];
}

export interface CoverageLanguage {
  code: string;
  name: string;
  uncovered_minutes: number;
  assignments: CoverageAssignment[];
}

export interface CoverageResponse {
  week_start: string;
  languages: CoverageLanguage[];
}

export interface SchedulerRow {
  id: number;
  name: string;
  email: string;
  phone: string;
}

export function languageName(code: string): string {
  return LANG_SEED.find((l) => l.code === code)?.name ?? code;
}
