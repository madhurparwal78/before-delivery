import type { Role, Setting, CredentialCode, RequestStatus } from "../shared/domain.js";

export type DbPerson = {
  id: string;
  role: Role;
  display_name: string;
  full_name: string;
  email: string;
  password_hash: string;
  phone: string | null;
  home_area: string | null;
  pay_rate_cents: number | null;
  organisation_id: string | null;
};

export type DbOrganisation = {
  id: string;
  name: string;
  code: string;
  hourly_rate_cents: number;
};

export type DbRequest = {
  id: string;
  reference: string;
  organisation_id: string;
  setting: Setting;
  required_credential: CredentialCode;
  starts_at: Date;
  duration_minutes: number;
  city: string;
  consumer_name: string;
  location_address: string;
  notes: string;
  status: RequestStatus;
  team_size: 1 | 2;
  team_reason: string | null;
  rotation_minutes: number;
  actual_minutes: number | null;
  free_cancel_until: Date;
  created_by: string;
  created_at: Date;
};

export type DbSeat = {
  id: string;
  request_id: string;
  label: "A" | "B";
  status: "open" | "confirmed";
  interpreter_id: string | null;
  confirmed_at: Date | null;
};

export type DbCredential = {
  id: string;
  interpreter_id: string;
  credential_type: CredentialCode;
  status: "uploaded" | "verified" | "expired";
  expires_on: Date | null;
  uploaded_at: Date;
  file_name: string | null;
  storage_key: string | null;
};

export type DbCharge = {
  id: string;
  request_id: string;
  organisation_id: string;
  kind: "interpreting" | "late_cancellation";
  billable_minutes: number;
  seats: number;
  hourly_rate_cents: number;
  amount_cents: number;
  billing_status: "pending" | "posted";
  killbill_invoice_id: string | null;
  created_at: Date;
};

export type DbHistoryEntry = {
  id: string;
  request_id: string;
  at: Date;
  actor_id: string | null;
  actor_name: string;
  action: string;
  detail: string;
};

export type Session = {
  id: string;
  person_id: string;
  created_at: Date;
};

export type RowOf<T> = T;
