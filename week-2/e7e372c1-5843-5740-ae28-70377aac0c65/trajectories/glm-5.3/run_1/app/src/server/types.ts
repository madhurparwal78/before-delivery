// Domain types shared across server modules. Names follow the brief's terms.

export type RestatementState =
  | "draft"
  | "in_review"
  | "returned"
  | "cleared"
  | "queued"
  | "published"
  | "superseded";

export type Role = "treasury_analyst" | "disclosure_counsel" | "disclosure_officer" | "operator";

export type RowKey =
  | "beginning-balance"
  | "eth-acquired"
  | "staking-rewards"
  | "ending-balance"
  | "cumulative-staking-rewards"
  | "diluted-shares";

export const ROW_KEYS: RowKey[] = [
  "beginning-balance",
  "eth-acquired",
  "staking-rewards",
  "ending-balance",
  "cumulative-staking-rewards",
  "diluted-shares",
];

export const ROW_LABELS: Record<RowKey, string> = {
  "beginning-balance": "Beginning ETH balance",
  "eth-acquired": "ETH acquired",
  "staking-rewards": "Staking rewards",
  "ending-balance": "Ending ETH balance",
  "cumulative-staking-rewards": "Cumulative staking rewards",
  "diluted-shares": "Assumed diluted shares",
};

export const ETH_ROW_KEYS: RowKey[] = [
  "beginning-balance",
  "eth-acquired",
  "staking-rewards",
  "ending-balance",
  "cumulative-staking-rewards",
];

export type ShareEventKind = "atm_settlement" | "warrant_exercise" | "buyback";

export const SHARE_EVENT_KINDS: ShareEventKind[] = ["atm_settlement", "warrant_exercise", "buyback"];

export const SHARE_EVENT_KIND_LABELS: Record<ShareEventKind, string> = {
  atm_settlement: "ATM settlement",
  warrant_exercise: "Warrant exercise",
  buyback: "Buyback",
};

export interface RestatementRows {
  "beginning-balance": string | null;
  "eth-acquired": string | null;
  "staking-rewards": string | null;
  "ending-balance": string | null;
  "cumulative-staking-rewards": string | null;
  "diluted-shares": string | null;
}

export interface ShareEventRecord {
  id: string;
  kind: ShareEventKind;
  shares: string;
  effective_date: string;
}

export interface RestatementRecord {
  id: string;
  version: number;
  week_ending: string;
  state: RestatementState;
  supersedes: string | null;
  correction_reason: string | null;
  rows: RestatementRows;
  share_events: ShareEventRecord[];
  accession: string | null;
  exhibit_page: number | null;
  exhibit: { status: "verified" | "rejected"; sha256: string; bytes: number; key: string | null } | null;
  prepared_by: { id: string; name: string };
  cleared_by: { id: string; name: string } | null;
  released_by: { id: string; name: string } | null;
  return_note: string | null;
  release_at: number | null;
  published_at: number | null;
  superseded_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface AuditEntryRecord {
  version: number;
  action: string;
  actor: { id: string; name: string } | null;
  at: number;
  from_state: RestatementState | null;
  to_state: RestatementState;
  note: string | null;
}

export type TickInstrument = "ETH-USD" | "VLCH";

export interface TickRecord {
  id: string;
  instrument: TickInstrument;
  price: string;
  at: number;
}

export interface ComputationInput {
  key: string;
  label: string;
  clock: "equity" | "eth" | "holdings";
  value: string;
  display: string;
  as_of: number;
  sets_as_of: boolean;
  source:
    | { kind: "exhibit"; restatement_id: string; accession: string; sha256: string; page: number; row: string }
    | { kind: "tick"; id: string; at: number }
    | { kind: "official_close"; date: string };
}

export interface ComputationRecord {
  id: string;
  figure: "eth-held" | "staking-rewards" | "eth-per-1000-diluted" | "mnav";
  value: string;
  display: string;
  as_of: number;
  computed_at: number;
  restatement_id: string | null;
  inputs: ComputationInput[];
  restated: { on: string; reason: string; superseded_by: string; superseding_computation_id: string } | null;
}

export interface StaffUserRecord {
  id: string;
  name: string;
  email: string;
  roles: Role[];
}
