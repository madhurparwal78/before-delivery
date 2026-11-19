export const ROLES = ['office_manager', 'managing_partner', 'staff_accountant', 'outside_bookkeeper'] as const;
export type Role = (typeof ROLES)[number];

export const DESK_ROLES: readonly Role[] = ROLES;
export const DESK_STAFF: readonly Role[] = ['office_manager', 'managing_partner'];

export type SeatState = 'confirmed' | 'waiting_on_billing' | 'release_waiting' | 'released';
export type PersonStatus = 'invited' | 'active' | 'travelling' | 'on_term' | 'left';
export type RuleState = 'drafted' | 'scheduled' | 'in_force' | 'superseded';
export type TurnState = 'scheduled' | 'due' | 'overdue' | 'turned';
export type ReviewStatus = 'open' | 'overdue' | 'signed_off';
export type Decision = 'undecided' | 'kept' | 'removed';
export type Health = 'sound' | 'out_of_policy' | 'exposed' | 'vendor_breached' | 'not_checked';

export type PersonRow = {
  id: string;
  order_no: number;
  full_name: string;
  email: string;
  handle: string;
  role: Role;
  aliases: string[];
  has_signed_in: boolean;
  left_at: Date | null;
  term_starts_on: string | null;
  term_ends_on: string | null;
  term_started: boolean;
  seat: SeatState;
  seat_change: 'add' | 'release' | null;
  seat_change_since: Date | null;
  seat_subscription_id: string | null;
  seat_bundle_key: string | null;
  keycloak_id: string | null;
  keycloak_enabled: boolean;
};

export type VaultRow = {
  id: string;
  name: string;
  formerly: string | null;
  off_when_travelling: boolean;
  drawer_order: number;
};

export type VendorRow = {
  id: string;
  name: string;
  domain: string;
  formerly: string | null;
  order_no: number;
};

export type CredentialRow = {
  id: string;
  vault_id: string;
  vendor_id: string;
  label: string;
  username: string;
  secret_cipher: string;
  secret_length: number;
  last_turned_on: string;
  secret_set_on: string;
  order_no: number;
};

export type RuleRow = {
  id: string;
  vault_id: string;
  min_length: number;
  effective_on: string;
  state: RuleState;
  version: number;
  drafted_by: string | null;
  signed_by: string | null;
  created_at: Date;
  took_force_at: Date | null;
};

export type TurnRow = {
  id: string;
  credential_id: string;
  rotation_id: string | null;
  kind: 'scheduled' | 'scope_loss';
  run_at: Date | null;
  run_office_date: string | null;
  due_by: string;
  state: TurnState;
};

export type SessionRow = {
  id: string;
  person_id: string;
  created_at: Date;
  ends_at: Date;
  signed_out_at: Date | null;
};
