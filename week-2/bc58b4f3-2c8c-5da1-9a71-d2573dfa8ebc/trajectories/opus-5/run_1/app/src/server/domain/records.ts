import type {
  AssignmentStatus,
  BillingStatus,
  Role,
  SeatStatus,
  Setting,
} from '../../shared/contract.js';

export interface SeatRecord {
  seat_id: number;
  seat_no: number;
  status: SeatStatus;
  holder_id: number | null;
  holder_initials: string | null;
  holder_name: string | null;
  verified: boolean;
  actual_minutes: number | null;
  round_trip_miles: number | null;
}

export interface AssignmentRecord {
  id: number;
  number: string;
  org_id: number;
  org_code: string;
  org_name: string;
  scheduler_id: number;
  scheduler_name: string;
  scheduler_phone: string;
  scheduler_email: string;
  language_code: string;
  language_name: string;
  setting: Setting;
  start_at: Date;
  duration_minutes: number;
  street_address: string;
  city: string;
  patient_initials: string;
  medical_notes: string;
  status: AssignmentStatus;
  offer_round: number;
  coverage_round: number;
  cancelled_at: Date | null;
  fee_applies: boolean | null;
  business_minutes_notice: number | null;
  fee_cents: number | null;
  billing_status: BillingStatus;
  total_cents: number | null;
  invoice_id: string | null;
  seats: SeatRecord[];
}

export interface Viewer {
  id: number;
  role: Role;
  orgId: number | null;
  languages: string[];
}

export function endInstantOf(record: Pick<AssignmentRecord, 'start_at' | 'duration_minutes'>): Date {
  return new Date(record.start_at.getTime() + record.duration_minutes * 60000);
}
