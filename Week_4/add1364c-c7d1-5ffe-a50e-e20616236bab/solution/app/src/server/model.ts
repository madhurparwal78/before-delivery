export type Role = "office_manager" | "managing_partner" | "staff_accountant" | "outside_bookkeeper";
export type SeatState = "confirmed" | "waiting_on_billing" | "release_waiting" | "released";

export const ROLES: Role[] = ["office_manager", "managing_partner", "staff_accountant", "outside_bookkeeper"];

export interface PersonRow {
  id: string;
  ord: number;
  full_name: string;
  email: string;
  handle: string;
  role: Role;
  aliases: string[];
  first_sign_in_at: Date | null;
  term_starts_on: string | null;
  term_ends_on: string | null;
  term_started: boolean;
  left_at: Date | null;
  seat: SeatState;
  seat_since: Date;
  seat_silent: boolean;
  created_at: Date;
}

export interface VaultRow {
  id: string;
  ord: number;
  name: string;
  off_when_travelling: boolean;
  formerly: string | null;
}

export interface VendorRow {
  id: string;
  ord: number;
  name: string;
  domain: string;
  formerly: string | null;
}

export interface CredentialRow {
  id: string;
  ord: number;
  vault_id: string;
  vendor_id: string;
  label: string;
  username: string;
  secret_sealed: string;
  secret_length: number;
  secret_rev: number;
  last_turned_on: string;
  imported_on: string | null;
}

export type RuleState = "drafted" | "scheduled" | "in_force" | "superseded";

export interface RuleRow {
  id: string;
  ord: number;
  vault_id: string;
  min_length: number;
  effective_on: string;
  state: RuleState;
  version: number;
  drafted_by: string;
  signed_by: string | null;
  took_force_on: string | null;
  created_at: Date;
}

export interface TurnRow {
  id: string;
  ord: number;
  credential_id: string;
  kind: "scheduled" | "scope_loss";
  rotation_id: string | null;
  run_at: Date | null;
  run_date: string | null;
  shifted: boolean;
  due_by: string;
  state: "due" | "overdue" | "turned";
}

export interface RotationRow {
  id: string;
  credential_id: string;
  interval_days: number;
  at_time: string;
  first_run_on: string;
  since: Date;
}

export const isDesk = (role: Role): boolean => role === "office_manager" || role === "managing_partner";
