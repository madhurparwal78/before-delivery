export type Role = "office_manager" | "managing_partner" | "staff_accountant" | "outside_bookkeeper";
export type Seat = "confirmed" | "waiting_on_billing" | "release_waiting" | "released";

export interface TravelWindow { id: string; starts_at: string; ends_at: string }
export interface Person {
  id: string; full_name: string; email: string; handle: string; role: Role; aliases: string[];
  status: "invited" | "active" | "travelling" | "on_term" | "left";
  vault_ids: string[]; term: { starts_on: string; ends_on: string } | null;
  travel: TravelWindow[]; seat: Seat; left_at: string | null;
}
export interface Clock { now: string; office_date: string; office_time: string; offset: string; time_zone: string }
export interface RuleBrief { id: string; min_length: number; effective_on: string }
export interface Rule extends RuleBrief {
  vault_id: string; state: "drafted" | "scheduled" | "in_force" | "superseded"; version: number;
  drafted_by: string; signed_by: string | null; stub_text: string | null;
}
export interface Vault {
  id: string; name: string; formerly: string | null; off_when_travelling: boolean;
  rule_in_force: RuleBrief; pending_rules: Rule[]; credential_count: number;
}
export interface VendorRef { id: string; name: string; domain: string; formerly: string | null }
export interface NextTurn { office_date: string; office_time: string; offset: string }
export type Health = "sound" | "out_of_policy" | "exposed" | "vendor_breached" | "not_checked";
export interface Credential {
  id: string; vault_id: string; vendor: VendorRef; label: string; username: string;
  held_by: { person_id: string; name: string; left: boolean }[];
  next_turn: NextTurn | null; health: Health; out_of_policy: boolean; out_of_policy_since: string | null;
  leeway_ends_at: string | null; rule_id: string; last_turned_on: string;
}
export interface Vendor extends VendorRef { renames: { old: string; new: string; by: string; at: string }[] }
export interface AsOfStub { rule_id: string; version: number; min_length: number; text: string; in_force: boolean }
export interface AsOfVault {
  vault_id: string; name: string; rule_in_force: RuleBrief; cylinder: "pending" | "in_force";
  stubs: AsOfStub[]; out_of_policy_count: number;
}
export interface AsOf { night: string; offset: string; starts_at: string; out_of_policy_count: number; vaults: AsOfVault[] }
export interface Run { office_date: string; office_time: string; offset: string; at: string; shifted: boolean }
export interface Rotation { id: string; credential_id: string; interval_days: number; at_time: string; first_run_on: string; next_runs: Run[] }
export interface CalendarEntry {
  turn_id: string | null; rotation_id: string | null; credential_id: string; label: string;
  vendor: { name: string; formerly: string | null }; kind: "scheduled" | "scope_loss";
  office_time: string | null; offset: string; at: string | null; shifted: boolean; due_by: string;
  state: "scheduled" | "due" | "overdue" | "turned";
}
export interface CalendarDay { office_date: string; offset: string; entries: CalendarEntry[] }
export interface ReviewSummary { id: string; quarter: string; opened_on: string; overdue_from: string; status: "open" | "overdue" | "signed_off"; signed_off_by: string | null }
export interface ReviewLine {
  id: string; person_id: string; person_name: string; vault_id: string; vault_name: string; vault_formerly: string | null;
  vendors: { name: string; formerly: string | null }[]; decision: "undecided" | "kept" | "removed";
  decided_by: string | null; decided_via: "review" | "scope_change" | null;
}
export interface Review extends ReviewSummary { decided: number; total: number; lines: ReviewLine[] }
export interface Billing {
  reachable: boolean; seats: number | null; seat_price: string; currency: string;
  next_invoice: { date: string; amount: string } | null; licence_term_ends_on: string | null;
  waiting: { person_id: string; name: string; change: "add" | "release"; since: string }[];
}
export interface HealthReport {
  office_date: string; feed: "ok" | "unreachable"; last_good_check_at: string | null;
  counts: { exposed: number; vendor_breached: number; out_of_policy: number; turns_due: number; turns_overdue: number };
  credentials: Credential[];
}
export interface ImportName {
  text: string; match: "email" | "full_name" | "alias" | "chosen" | "not_on_record" | null; person_id: string | null;
  held: "no_match" | "ambiguous" | null; candidates: { person_id: string; full_name: string }[];
}
export interface ImportRow { row: number; outcome: "created" | "matched" | "held" | "rejected"; credential_id: string | null; reason: string | null; names: ImportName[] }
export interface ImportResult { id: string; filename: string; counts: { created: number; matched: number; held: number; rejected: number }; rows: ImportRow[] }
export interface AuditEntry {
  id: string; seq: number; at: string; office_day: string; office_time: string; offset: string;
  actor: { person_id: string; name: string } | { system: string };
  action: string; subject: { kind: string; id: string; name: string }; details: Record<string, unknown>;
}
export interface AuditPage { office_day: string; order: string; entries: AuditEntry[]; next_cursor: string | null }
