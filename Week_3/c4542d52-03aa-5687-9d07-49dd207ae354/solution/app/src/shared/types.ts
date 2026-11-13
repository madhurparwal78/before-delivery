export type Role = "founder_admin" | "board_member" | "option_holder" | "leaver" | "investor";
export type VestingType = "standard" | "monthly";
export type GrantState = "draft" | "board_queue" | "approved" | "offered" | "accepted" | "expired";
export type ExerciseOrderState = "pending" | "held" | "issued" | "cancelled";
export type TenderState = "open" | "closed" | "allocated";
export type DocumentKind = "grant_agreement" | "exercise_notice" | "tender_nda";
export type ShareClass = "Common" | "Series Seed Preferred" | "Series A Preferred";
export type CellState = "vested" | "unvested" | "cancelled";
export type ValuationStatus = "current" | "superseded" | "lapsed";
export type LedgerKind =
  | "issuance"
  | "grant_accepted"
  | "exercise_issued"
  | "options_cancelled"
  | "tender_transfer"
  | "pool_resized";

export type Departure = {
  terminated_at: string;
  termination_date: string;
  window_ends_at: string;
  warnings_at: string[];
};

export type Person = {
  id: string;
  name: string;
  first_name: string;
  email: string;
  role: Role;
  access: "active" | "removed" | "none";
  departure: Departure | null;
};

export type Tranche = {
  month: number;
  date: string;
  cumulative: number;
  state: CellState;
  cost_at_strike: string;
  vested_ownership: string;
};

type AgreementStatus = "none" | "pending" | "sealed" | "paper";

export type Grant = {
  id: string;
  holder_id: string | null;
  holder_name: string | null;
  options: number | null;
  strike: string | null;
  vesting_type: VestingType | null;
  vesting_start: string | null;
  state: GrantState;
  draft_version: number;
  votes: { approve: number; decline: number };
  offered_at: string | null;
  offer_expires_at: string | null;
  offer_warning_at: string | null;
  accepted_at: string | null;
  agreement: { status: AgreementStatus; document_id: string | null };
  vested: number;
  exercised: number;
  cancelled: number;
  forfeited: number;
  in_open_orders: number;
  exercisable: number;
  next_tranche: { date: string; cumulative: number } | null;
  exercise_window_ends_at: string | null;
  schedule: Tranche[];
  server_date: string;
  server_time: string;
};

export type PaymentRecord = {
  id: string;
  status: string;
  amount_cents: number;
  currency: string;
  reference: string;
  confirmed_at: string | null;
};

export type ExerciseOrder = {
  id: string;
  grant_id: string;
  holder_id: string;
  options: number;
  strike: string;
  cost: string;
  idempotency_key: string;
  state: ExerciseOrderState;
  placed_at: string;
  issued_at: string | null;
  payment: PaymentRecord | null;
  notice: { document_id: string; status: "pending" | "sealed" } | null;
};

export type TenderMine = {
  nda: { status: "none" | "pending" | "sealed"; document_id: string | null };
  draft_shares: string | null;
  submission: { shares: number; submitted_at: string; sequence: number } | null;
  projected_allocation: number | null;
  allocation: number | null;
  proceeds: string | null;
};

export type TenderSubmission = {
  holder_id: string;
  holder_name: string;
  shares: number;
  submitted_at: string;
  sequence: number;
  allocation: number | null;
  proceeds: string | null;
};

export type Tender = {
  id: string;
  title: string;
  buyer: string;
  price_per_share: string;
  share_cap: number;
  closes_at: string;
  state: TenderState;
  total_tendered: number;
  remaining_cap: number;
  oversubscribed_by: number;
  server_time: string;
  mine?: TenderMine;
  submissions?: TenderSubmission[];
};

export type Document = {
  id: string;
  kind: DocumentKind;
  title: string;
  owner_id: string;
  status: "pending" | "sealed";
  sha256: string;
  vault_key: string;
  created_at: string;
  version: number;
  supersedes: string | null;
  superseded_by: string | null;
};

export type CapTableRow = {
  key: string;
  label: string;
  issued_shares: number;
  options_outstanding: number;
  fully_diluted: number;
  ownership: string;
};

export type CapTable = {
  fully_diluted_total: number;
  rows: CapTableRow[];
  total_ownership: string;
};

export type LedgerEntry = {
  id: string;
  at: string;
  holder_id: string | null;
  holder_name: string | null;
  kind: LedgerKind;
  class: ShareClass | null;
  shares_delta: number;
  options_delta: number;
  reference: string;
};

export type Pool = {
  authorized: number;
  outstanding: number;
  exercised: number;
  reserved: number;
  available: number;
  unallocated: number;
};

export type Valuation = {
  id: string;
  effective_on: string;
  expires_on: string;
  fmv_per_share: string;
  firm: string;
  status: ValuationStatus;
};

export type QueueEntry = {
  id: string;
  holder_name: string;
  options: number;
  strike: string;
  vesting_type: VestingType;
  vesting_start: string;
  approvals: number;
  declines: number;
  my_vote: "approve" | "decline" | null;
};

export type ScenarioResult = {
  fully_diluted_before: number;
  unallocated_pool_before: number;
  pool_top_up: number;
  price_per_share: string;
  new_shares: number;
  fully_diluted_after: number;
  new_investor_percent: string;
  pool_after_percent: string;
  dilution_percent: string;
  investment_used: string;
  fmv_per_share: string | null;
  price_to_fmv: string | null;
};

export type SavedScenario = {
  id: string;
  name: string;
  pre_money: string;
  investment: string;
  target_pool_percent: string;
  saved_at: string;
};

export type Portal =
  | { first_name: string; vested_today: number; total_options: number; next_tranche_date: string | null }
  | { first_name: string; exercisable: number; window_ends_at: string | null }
  | {
      first_name: string;
      fully_diluted_shares: number;
      ownership: string;
      open_tender: { id: string; closes_at: string } | null;
    }
  | { first_name: string; awaiting_vote: number; quorum: number; board_size: number }
  | { first_name: string; fully_diluted_total: number; offers_to_send: number };

export type Me = {
  person: Person;
  server_time: string;
  server_date: string;
  time_zone: string;
  event_seq: number;
};

export type ApiErrorBody = {
  error: { code: string; message: string };
  fields?: Record<string, string>;
  grant?: Grant;
  order?: ExerciseOrder;
  tender?: Tender;
};

export type LiveMessage = { seq: number; type: string; at: string; data: Record<string, unknown> };
