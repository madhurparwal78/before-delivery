/** The server payload shapes the browser renders. */
export type FigureKey = 'eth-held' | 'staking-rewards' | 'eth-per-1000-diluted' | 'mnav';

export type ClockKey = 'equity' | 'eth' | 'holdings';

export interface ExhibitSource {
  kind: 'exhibit';
  restatement_id: string;
  accession: string;
  sha256: string;
  page: number;
  row: string;
}

export interface TickSource {
  kind: 'tick';
  id: string;
  at: string;
}

export interface OfficialCloseSource {
  kind: 'official_close';
  date: string;
}

export type ComputationSource = ExhibitSource | TickSource | OfficialCloseSource;

export interface ComputationInput {
  key: string;
  label: string;
  clock: ClockKey;
  value: string;
  display: string;
  as_of: string;
  sets_as_of: boolean;
  source: ComputationSource;
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
}

export interface HistoryRow {
  restatement_id: string;
  week_ending: string;
  state: 'published' | 'superseded';
  beginning_balance: string;
  eth_acquired: string;
  staking_rewards: string;
  ending_balance: string;
  cumulative_staking_rewards: string;
  diluted_shares: string;
  eth_per_1000_diluted: { computation_id: string; value: string; display: string } | null;
  exhibit: { accession: string; sha256: string; page: number } | null;
  published_at: string | null;
  restated: { on: string; reason: string; superseded_by: string } | null;
}

export interface BoardPayload {
  server_time: string;
  market_date: string;
  vault: 'available' | 'unavailable';
  clocks: {
    equity: {
      status: 'open' | 'closed';
      closes_at: string | null;
      last_trade: { id: string; price: string; at: string } | null;
      official_close: { date: string; price: string } | null;
    };
    eth: {
      status: 'live' | 'stale';
      last_tick: { id: string; price: string; at: string } | null;
    };
    holdings: { week_ending: string | null; as_of: string | null; restatement_id: string | null };
  };
  figures: Computation[];
  history: HistoryRow[];
}

export interface CitationPayload {
  citation: { figure: FigureKey; date: string; provisional: boolean };
  computation: Computation;
}

export type RestatementState =
  | 'draft'
  | 'in_review'
  | 'returned'
  | 'cleared'
  | 'queued'
  | 'published'
  | 'superseded';

export interface ShareEventPayload {
  id: string;
  kind: 'atm_settlement' | 'warrant_exercise' | 'buyback';
  shares: string;
  effective_date: string;
}

export interface RestatementPayload {
  id: string;
  version: number;
  week_ending: string;
  state: RestatementState;
  supersedes: string | null;
  correction_reason: string | null;
  rows: Record<string, string | null>;
  share_events: ShareEventPayload[];
  accession: string | null;
  exhibit_page: number | null;
  exhibit: { status: 'verified' | 'rejected'; sha256: string; bytes: number; key: string | null } | null;
  prepared_by: { id: string; name: string };
  cleared_by: { id: string; name: string } | null;
  released_by: { id: string; name: string } | null;
  return_note: string | null;
  release_at: string | null;
  published_at: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEntryPayload {
  version: number;
  action: string;
  actor: { id: string; name: string } | null;
  at: string;
  from_state: RestatementState | null;
  to_state: RestatementState;
  note: string | null;
}

export interface StaffUserPayload {
  id: string;
  name: string;
  email: string;
  roles: ('treasury_analyst' | 'disclosure_counsel' | 'disclosure_officer' | 'operator')[];
}

export interface ErrorPayload {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface TapePayload {
  state: 'playing' | 'paused';
  position: number;
}

export interface ClockPayload {
  now: string;
  rehearsal: boolean;
}
