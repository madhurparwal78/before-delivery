// Vocabulary and wire shapes shared by the server and the browser.

export const ROW_KEYS = [
  "beginning-balance",
  "eth-acquired",
  "staking-rewards",
  "ending-balance",
  "cumulative-staking-rewards",
  "diluted-shares",
] as const;
export type RowKey = (typeof ROW_KEYS)[number];

/** One value per row key, built by `make` so no object is ever cast into the row shape. */
export function eachRow<T>(make: (key: RowKey) => T): Record<RowKey, T> {
  return {
    "beginning-balance": make("beginning-balance"),
    "eth-acquired": make("eth-acquired"),
    "staking-rewards": make("staking-rewards"),
    "ending-balance": make("ending-balance"),
    "cumulative-staking-rewards": make("cumulative-staking-rewards"),
    "diluted-shares": make("diluted-shares"),
  };
}

export const ROW_LABELS: Record<RowKey, string> = {
  "beginning-balance": "Beginning ETH balance",
  "eth-acquired": "ETH acquired",
  "staking-rewards": "Staking rewards",
  "ending-balance": "Ending ETH balance",
  "cumulative-staking-rewards": "Cumulative staking rewards",
  "diluted-shares": "Assumed diluted shares",
};

export const FIGURE_KEYS = ["eth-held", "staking-rewards", "eth-per-1000-diluted", "mnav"] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

export const FIGURE_LABELS: Record<FigureKey, string> = {
  "eth-held": "Total ETH held",
  "staking-rewards": "Cumulative staking rewards",
  "eth-per-1000-diluted": "ETH per 1,000 diluted shares",
  mnav: "mNAV",
};

export const ROLES = ["treasury_analyst", "disclosure_counsel", "disclosure_officer", "operator"] as const;
export type Role = (typeof ROLES)[number];

export const RESTATEMENT_STATES = ["draft", "in_review", "returned", "cleared", "queued", "published", "superseded"] as const;
export type RestatementState = (typeof RESTATEMENT_STATES)[number];

export const SHARE_EVENT_KINDS = ["atm_settlement", "warrant_exercise", "buyback"] as const;
export type ShareEventKind = (typeof SHARE_EVENT_KINDS)[number];

export const SHARE_EVENT_LABELS: Record<ShareEventKind, string> = {
  atm_settlement: "ATM settlement",
  warrant_exercise: "Warrant exercise",
  buyback: "Buyback",
};

export const AUDIT_ACTIONS = [
  "create",
  "edit",
  "exhibit_pending",
  "exhibit_verified",
  "exhibit_rejected",
  "submit",
  "return",
  "clear",
  "release_queued",
  "publish",
  "withdraw",
  "supersede",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type ClockKey = "equity" | "eth" | "holdings";

interface ExhibitSource {
  kind: "exhibit";
  restatement_id: string;
  accession: string;
  sha256: string;
  page: number;
  row: string;
}
interface TickSource {
  kind: "tick";
  id: string;
  at: string;
}
interface OfficialCloseSource {
  kind: "official_close";
  date: string;
}
export type InputSource = ExhibitSource | TickSource | OfficialCloseSource;

export interface ComputationInput {
  key: string;
  label: string;
  clock: ClockKey;
  value: string;
  display: string;
  as_of: string;
  sets_as_of: boolean;
  source: InputSource;
}

export interface ExhibitRowValue {
  key: RowKey;
  label: string;
  value: string;
  display: string;
}

export interface ComputationExhibit {
  accession: string;
  sha256: string;
  page: number;
  rows: ExhibitRowValue[];
}

export interface Restated {
  on: string;
  reason: string;
  superseded_by: string;
  superseding_computation_id: string;
}

export interface Computation {
  id: string;
  figure: FigureKey;
  label: string;
  value: string;
  display: string;
  as_of: string;
  computed_at: string;
  restatement_id: string;
  restated: Restated | null;
  inputs: ComputationInput[];
  exhibit: ComputationExhibit;
}

export interface TickView {
  id: string;
  price: string;
  at: string;
}

export interface HistoryRow {
  restatement_id: string;
  week_ending: string;
  state: "published" | "superseded";
  beginning_balance: string;
  eth_acquired: string;
  staking_rewards: string;
  ending_balance: string;
  cumulative_staking_rewards: string;
  diluted_shares: string;
  eth_per_1000_diluted: { computation_id: string; value: string; display: string };
  exhibit: { accession: string; sha256: string; page: number };
  published_at: string;
  restated: { on: string; reason: string; superseded_by: string } | null;
}

export interface BoardResponse {
  server_time: string;
  market_date: string;
  vault: "available" | "unavailable";
  clocks: {
    equity: {
      status: "open" | "closed";
      closes_at: string | null;
      last_trade: TickView | null;
      official_close: { date: string; price: string } | null;
    };
    eth: { status: "live" | "stale"; last_tick: TickView | null };
    holdings: { week_ending: string; as_of: string; restatement_id: string };
  };
  figures: Computation[];
  history: HistoryRow[];
}

export interface CitationResponse {
  citation: { figure: FigureKey; date: string; provisional: boolean };
  computation: Computation;
}

export interface ShareEventView {
  id: string;
  kind: ShareEventKind;
  shares: string;
  effective_date: string;
}

export interface PersonView {
  id: string;
  name: string;
}

export interface ExhibitView {
  status: "verified" | "rejected";
  sha256: string;
  bytes: number;
  key: string | null;
}

export interface RestatementView {
  id: string;
  version: number;
  week_ending: string;
  state: RestatementState;
  supersedes: string | null;
  correction_reason: string | null;
  rows: Record<RowKey, string | null>;
  share_events: ShareEventView[];
  accession: string | null;
  exhibit_page: number | null;
  exhibit: ExhibitView | null;
  prepared_by: PersonView;
  cleared_by: PersonView | null;
  released_by: PersonView | null;
  return_note: string | null;
  release_at: string | null;
  published_at: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEntryView {
  version: number;
  action: AuditAction;
  actor: PersonView | null;
  at: string;
  from_state: RestatementState | null;
  to_state: RestatementState;
  note: string | null;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  roles: Role[];
}

export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface ReleaseResponse {
  outcome: "queued" | "published";
  restatement: RestatementView;
}
